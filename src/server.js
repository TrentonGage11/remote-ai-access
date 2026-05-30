import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import multer from "multer";
import prettier from "prettier";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import { promisify } from "util";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "async_hooks";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(__dirname, "..", "public");
const modelsCsvPath = path.join(__dirname, "..", "models.csv");
const sandboxBaseRoot = path.resolve(process.env.SANDBOX_ROOT || path.join(__dirname, "..", "sandbox"));
const maxReadBytes = Number(process.env.FILE_API_MAX_READ_BYTES || 1024 * 1024);
const gitUserName = process.env.SANDBOX_GIT_USER_NAME || "Remote AI Access";
const gitUserEmail = process.env.SANDBOX_GIT_USER_EMAIL || "remote-ai-access@local";
const workspaceCookieName = String(process.env.WORKSPACE_COOKIE_NAME || "raa_workspace").trim() || "raa_workspace";
const defaultWorkspaceCode = String(process.env.DEFAULT_WORKSPACE_CODE || "default").trim().toLowerCase() || "default";
const allowedWorkspaceCodes = String(process.env.WORKSPACE_ACCESS_CODES || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const enableAutoSessionBranching = String(process.env.ENABLE_AUTO_SESSION_BRANCH || "false").trim().toLowerCase() === "true";
const sessionBranchPrefixRaw = String(process.env.SESSION_BRANCH_PREFIX || "session").trim().toLowerCase() || "session";
const sessionBranchPrefix = sessionBranchPrefixRaw.replace(/[^a-z0-9/_-]/g, "").replace(/^\/+|\/+$/g, "") || "session";
const enableNightlyWorkspaceBackup = String(process.env.ENABLE_NIGHTLY_WORKSPACE_BACKUP || "true").trim().toLowerCase() === "true";
const workspaceBackupRoot = path.resolve(process.env.WORKSPACE_BACKUP_ROOT || path.join(sandboxBaseRoot, "_backups"));
const workspaceBackupUtcHour = Math.max(0, Math.min(23, Number(process.env.WORKSPACE_BACKUP_UTC_HOUR || 3)));
const workspaceBackupRetentionDays = Math.max(1, Math.min(365, Number(process.env.WORKSPACE_BACKUP_RETENTION_DAYS || 21)));
const workspaceGitRemoteRoot = path.resolve(process.env.WORKSPACE_GIT_REMOTE_ROOT || path.join(sandboxBaseRoot, "workspace-remotes"));
const workspaceGitRemoteName = String(process.env.WORKSPACE_GIT_REMOTE_NAME || "origin").trim() || "origin";
const workspaceGitSshHost = String(process.env.WORKSPACE_GIT_SSH_HOST || "").trim();
const workspaceGitSshUser = String(process.env.WORKSPACE_GIT_SSH_USER || "").trim() || "root";
const defaultUploadMaxBytes = Math.max(1024, Number(process.env.FILE_API_UPLOAD_MAX_BYTES || 20 * 1024 * 1024));
const workspaceUploadBypassCodesRaw = String(process.env.WORKSPACE_UPLOAD_BYPASS_CODES || "");
const workspaceUploadBypassCodes = parseWorkspaceUploadBypassCodes(workspaceUploadBypassCodesRaw);
const chunkUploadThresholdBytes = Math.max(1024 * 1024, Number(process.env.FILE_API_CHUNK_UPLOAD_THRESHOLD_BYTES || 64 * 1024 * 1024));
const chunkUploadChunkSizeBytes = Math.max(256 * 1024, Number(process.env.FILE_API_CHUNK_SIZE_BYTES || 4 * 1024 * 1024));
const chunkUploadSessionMaxAgeMs = Math.max(60_000, Number(process.env.FILE_API_CHUNK_SESSION_MAX_AGE_MS || 2 * 60 * 60 * 1000));

const execFileAsync = promisify(execFile);
const safeTerminalCommands = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "bun",
  "python", "python3", "pip", "pip3", "pytest",
  "git", "make", "cmake", "go", "cargo", "rustc",
  "php", "composer", "ruby", "bundle", "java", "javac", "mvn", "gradle",
  "cd", "ls", "dir", "pwd", "echo", "cat", "type", "grep", "rg", "find", "head", "tail", "wc",
  "sed", "awk", "sort", "uniq", "cut", "tr", "xargs", "stat", "du", "df", "file",
  "date", "whoami", "id", "uname", "which", "where", "tree", "env", "printenv",
  "mkdir", "touch", "cp", "mv", "rm", "rmdir", "chmod",
  "basename", "dirname", "realpath", "readlink", "tee", "cmp", "diff", "patch",
  "tar", "zip", "unzip", "7z", "7za", "7zr", "vfa"
]);
const dockerOnlyTerminalCommands = new Set(["sh", "bash", "dash", "apt", "apt-get", "curl", "wget", "jq"]);
const blockedTerminalCommandsAlways = new Set(["sudo", "su", "systemctl", "service", "docker", "podman", "mount", "umount", "chown"]);
const blockedTerminalCommandsHostOnly = new Set(["apt", "apt-get", "dnf", "yum", "apk", "pacman"]);
const blockedTerminalArgPatterns = [/^--prefix=/i, /^--root=/i, /^--target=/i];
const blockedTerminalPathArgPatterns = [
  /^[a-zA-Z]:[\\/]/,
  /^[/\\]/,
  /^~(?:[/\\]|$)/,
  /(?:^|[/\\])\.\.(?:[/\\]|$)/,
  /^--[^=]+=([a-zA-Z]:[\\/]|[/\\]|~(?:[/\\]|$))/i
];
const shellLikeConditionalOperators = new Set(["&&", "||", ";"]);
const shellLikeRedirectionTokens = new Set(["2>&1", "1>&2", "1>/dev/null", "2>/dev/null", ">/dev/null"]);
const scheduledTasks = new Map();
const notificationStore = [];
const uploadSessionStore = new Map();
const chatJobStore = new Map();
let scheduledTaskCounter = 0;
let chatJobCounter = 0;
const workspaceContextStore = new AsyncLocalStorage();
const workspaceReadyPromises = new Map();
const workspaceBranchState = new Map();
const terminalRuntime = String(process.env.TERMINAL_RUNTIME || "host").trim().toLowerCase() === "docker" ? "docker" : "host";
const terminalDockerImage = String(process.env.TERMINAL_DOCKER_IMAGE || "node:20-bookworm").trim() || "node:20-bookworm";
const terminalDockerMemory = String(process.env.TERMINAL_DOCKER_MEMORY || "1g").trim() || "1g";
const terminalDockerCpus = String(process.env.TERMINAL_DOCKER_CPUS || "1.0").trim() || "1.0";
const terminalDockerPidsLimit = Math.max(64, Math.min(2048, Number(process.env.TERMINAL_DOCKER_PIDS_LIMIT || 256)));
const terminalDockerNetwork = String(process.env.TERMINAL_DOCKER_NETWORK || "bridge").trim() || "bridge";
const terminalHostFallbackCommands = new Set(
  String(process.env.TERMINAL_HOST_FALLBACK_COMMANDS || "7z,7za,7zr,vfa")
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)
);
const terminalVfaCommand = String(process.env.TERMINAL_VFA_COMMAND || "").trim();
const terminalVfaScript = String(process.env.TERMINAL_VFA_SCRIPT || "../VFA/vfa.py").trim() || "../VFA/vfa.py";
let workspaceBackupTimer = null;
let lastAuditRetentionRunAt = 0;

const port = Number(process.env.PORT || 8787);
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1";
const defaultProvider = "openai";
const xaiDefaultModel = process.env.XAI_MODEL || "grok-4.3";
const agentMaxStepsHardLimit = Math.max(16, Math.min(4096, Number(process.env.AGENT_MAX_STEPS_HARD_LIMIT || 1024)));
const agentMaxSteps = Math.max(1, Math.min(agentMaxStepsHardLimit, Number(process.env.AGENT_MAX_STEPS || 16)));
const agentMaxStepsOverrideLimit = Math.max(agentMaxSteps, Math.min(agentMaxStepsHardLimit, Number(process.env.AGENT_MAX_STEPS_OVERRIDE_LIMIT || 40)));
const agentMaxStepsOverrideCode = String(process.env.AGENT_MAX_STEPS_OVERRIDE_CODE || "").trim();
const agentWebTimeoutMs = Math.max(1000, Math.min(40000, Number(process.env.AGENT_WEB_TIMEOUT_MS || 16000)));
const chatJobMaxAgeMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(process.env.CHAT_JOB_MAX_AGE_MS || 2 * 60 * 60 * 1000)));
const chatJobMaxEntries = Math.max(20, Math.min(2000, Number(process.env.CHAT_JOB_MAX_ENTRIES || 300)));
const chatJobEventHistoryMax = Math.max(20, Math.min(4000, Number(process.env.CHAT_JOB_EVENT_HISTORY_MAX || 240)));
const auditLogMaxBytes = Math.max(128 * 1024, Math.min(64 * 1024 * 1024, Number(process.env.AUDIT_LOG_MAX_BYTES || 8 * 1024 * 1024)));
const auditRetentionDays = Math.max(1, Math.min(365, Number(process.env.AUDIT_RETENTION_DAYS || 14)));
const auditRetentionPruneIntervalMs = Math.max(30_000, Math.min(60 * 60 * 1000, Number(process.env.AUDIT_RETENTION_PRUNE_INTERVAL_MS || 5 * 60 * 1000)));
const githubPat = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "").trim();
const xaiApiKey = String(process.env.XAI_API_KEY || "").trim();
const xaiApiBaseUrl = String(process.env.XAI_API_BASE_URL || "https://api.x.ai/v1").trim().replace(/\/+$/, "");
const copilotApiBaseUrl = String(process.env.COPILOT_API_BASE_URL || "https://models.github.ai/inference").trim();
const copilotApiVersion = String(process.env.COPILOT_API_VERSION || "2026-03-10").trim();
const allowedModels = String(process.env.OPENAI_ALLOWED_MODELS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const xaiAllowedModels = String(process.env.XAI_ALLOWED_MODELS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || "";
const allowedOrigins = rawAllowedOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const apiKeyAuthEnabled = String(process.env.ENABLE_API_KEY_AUTH || "false").trim().toLowerCase() === "true";
const apiKeyHeaderName = String(process.env.API_KEY_HEADER_NAME || "x-api-key").trim().toLowerCase() || "x-api-key";
const apiKeyValues = String(process.env.API_KEYS || "")
  .split(",")
  .map((item) => String(item || "").trim())
  .filter(Boolean);
const apiKeyProtectedPathPrefixes = String(process.env.API_KEY_PROTECTED_PATH_PREFIXES || "/api/files,/api/session/workspace/git,/api/tests,/api/notifications")
  .split(",")
  .map((item) => String(item || "").trim())
  .filter(Boolean);
const apiKeyExemptPathPrefixes = String(process.env.API_KEY_EXEMPT_PATH_PREFIXES || "")
  .split(",")
  .map((item) => String(item || "").trim())
  .filter(Boolean);
const apiKeyRequireHeaderOnly = String(process.env.API_KEY_REQUIRE_HEADER_ONLY || "true").trim().toLowerCase() !== "false";
const adminDashboardToken = String(process.env.ADMIN_DASHBOARD_TOKEN || "").trim();
const adminSettingsDbPath = path.resolve(process.env.ADMIN_SETTINGS_DB_PATH || path.join(sandboxBaseRoot, "_admin", "settings-db.json"));
let adminSettingsCache = null;
let adminSettingsLoaded = false;

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey && !xaiApiKey && !githubPat) {
  console.error("Missing provider credentials. Set at least one of OPENAI_API_KEY, XAI_API_KEY, or GITHUB_PAT/GITHUB_TOKEN.");
  process.exit(1);
}

const client = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;

// This app runs behind Apache reverse proxy in production.
app.set("trust proxy", 1);

function isValidModelName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{2,64}$/.test(value);
}

function isValidCopilotModelName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._/-]{2,120}$/.test(value);
}

function resolveModel(requestedModel) {
  if (!isValidModelName(requestedModel)) {
    return defaultModel;
  }

  if (allowedModels.length > 0 && !allowedModels.includes(requestedModel)) {
    return defaultModel;
  }

  return requestedModel;
}

function isValidXaiModelName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{2,80}$/.test(value);
}

function resolveXaiModel(requestedModel) {
  if (!isValidXaiModelName(requestedModel)) {
    return xaiDefaultModel;
  }

  if (xaiAllowedModels.length > 0 && !xaiAllowedModels.includes(requestedModel)) {
    return xaiDefaultModel;
  }

  return requestedModel;
}

function normalizeReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["none", "minimal", "low", "medium", "high", "xhigh"].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeSandboxRelativePath(inputPath) {
  const cleaned = String(inputPath || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  if (cleaned.includes("\0")) {
    throw new Error("path contains invalid characters");
  }

  return cleaned;
}

function normalizeWorkspaceCode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,47}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeUploadBypassCode(value) {
  let normalized = String(value || "");
  try {
    normalized = normalized.normalize("NFKC");
  } catch {
    // Unicode normalization may not be available in all runtimes.
  }

  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (normalized.length >= 2 && normalized.startsWith("`") && normalized.endsWith("`")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\s+/g, "");
}

function parseWorkspaceUploadBypassCodes(rawValue) {
  const map = new Map();
  const source = String(rawValue || "");
  for (const entry of source.split(",")) {
    const item = String(entry || "").trim();
    if (!item) {
      continue;
    }
    const idx = item.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const workspace = normalizeWorkspaceCode(item.slice(0, idx));
    const code = normalizeUploadBypassCode(item.slice(idx + 1));
    if (!workspace || !code) {
      continue;
    }
    map.set(workspace, code);
  }
  return map;
}

function normalizePathPrefixList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const normalized = [];
  const dedupe = new Set();
  for (const item of list) {
    const prefix = normalizeApiPathPrefix(item);
    if (!prefix || dedupe.has(prefix)) {
      continue;
    }
    dedupe.add(prefix);
    normalized.push(prefix);
  }
  return normalized;
}

function normalizeApiKeyList(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const dedupe = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item || "").trim();
    if (!key || dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    out.push(key);
  }
  return out;
}

function getDefaultAdminSecuritySettings() {
  return {
    apiKeyAuthEnabled,
    apiKeyHeaderName,
    apiKeys: apiKeyValues,
    apiKeyProtectedPathPrefixes: normalizePathPrefixList(apiKeyProtectedPathPrefixes),
    apiKeyExemptPathPrefixes: normalizePathPrefixList(apiKeyExemptPathPrefixes),
    apiKeyRequireHeaderOnly,
    agentMaxStepsOverrideCode,
    workspaceUploadBypassCodesRaw,
    updatedAt: null
  };
}

async function loadAdminSecuritySettings() {
  if (adminSettingsLoaded) {
    return adminSettingsCache;
  }

  const fallback = getDefaultAdminSecuritySettings();
  try {
    const raw = await fsp.readFile(adminSettingsDbPath, "utf8");
    const parsed = JSON.parse(raw);
    adminSettingsCache = {
      ...fallback,
      ...parsed,
      apiKeyHeaderName: String(parsed?.apiKeyHeaderName || fallback.apiKeyHeaderName).trim().toLowerCase() || "x-api-key",
      apiKeys: normalizeApiKeyList(parsed?.apiKeys ?? fallback.apiKeys),
      apiKeyProtectedPathPrefixes: normalizePathPrefixList(parsed?.apiKeyProtectedPathPrefixes ?? fallback.apiKeyProtectedPathPrefixes),
      apiKeyExemptPathPrefixes: normalizePathPrefixList(parsed?.apiKeyExemptPathPrefixes ?? fallback.apiKeyExemptPathPrefixes),
      apiKeyAuthEnabled: Boolean(parsed?.apiKeyAuthEnabled),
      apiKeyRequireHeaderOnly: parsed?.apiKeyRequireHeaderOnly !== false,
      agentMaxStepsOverrideCode: String(parsed?.agentMaxStepsOverrideCode || fallback.agentMaxStepsOverrideCode).trim(),
      workspaceUploadBypassCodesRaw: String(parsed?.workspaceUploadBypassCodesRaw ?? fallback.workspaceUploadBypassCodesRaw ?? "").trim()
    };
  } catch {
    adminSettingsCache = fallback;
  }

  adminSettingsLoaded = true;
  return adminSettingsCache;
}

async function saveAdminSecuritySettings(update = {}) {
  const current = await loadAdminSecuritySettings();
  const next = {
    ...current,
    ...update,
    apiKeyHeaderName: String(update?.apiKeyHeaderName ?? current.apiKeyHeaderName).trim().toLowerCase() || "x-api-key",
    apiKeys: normalizeApiKeyList(update?.apiKeys ?? current.apiKeys),
    apiKeyProtectedPathPrefixes: normalizePathPrefixList(update?.apiKeyProtectedPathPrefixes ?? current.apiKeyProtectedPathPrefixes),
    apiKeyExemptPathPrefixes: normalizePathPrefixList(update?.apiKeyExemptPathPrefixes ?? current.apiKeyExemptPathPrefixes),
    apiKeyAuthEnabled: Boolean(update?.apiKeyAuthEnabled ?? current.apiKeyAuthEnabled),
    apiKeyRequireHeaderOnly: update?.apiKeyRequireHeaderOnly !== false,
    agentMaxStepsOverrideCode: String(update?.agentMaxStepsOverrideCode ?? current.agentMaxStepsOverrideCode ?? "").trim(),
    workspaceUploadBypassCodesRaw: String(update?.workspaceUploadBypassCodesRaw ?? current.workspaceUploadBypassCodesRaw ?? "").trim(),
    updatedAt: new Date().toISOString()
  };

  await fsp.mkdir(path.dirname(adminSettingsDbPath), { recursive: true });
  await fsp.writeFile(adminSettingsDbPath, JSON.stringify(next, null, 2), "utf8");
  adminSettingsCache = next;
  adminSettingsLoaded = true;
  return next;
}

async function getEffectiveSecuritySettings() {
  const settings = await loadAdminSecuritySettings();
  return {
    apiKeyAuthEnabled: settings.apiKeyAuthEnabled,
    apiKeyHeaderName: String(settings.apiKeyHeaderName || "x-api-key").trim().toLowerCase() || "x-api-key",
    apiKeys: normalizeApiKeyList(settings.apiKeys),
    apiKeyProtectedPathPrefixes: normalizePathPrefixList(settings.apiKeyProtectedPathPrefixes),
    apiKeyExemptPathPrefixes: normalizePathPrefixList(settings.apiKeyExemptPathPrefixes),
    apiKeyRequireHeaderOnly: settings.apiKeyRequireHeaderOnly !== false,
    agentMaxStepsOverrideCode: String(settings.agentMaxStepsOverrideCode || "").trim(),
    workspaceUploadBypassCodes: parseWorkspaceUploadBypassCodes(settings.workspaceUploadBypassCodesRaw)
  };
}

function getEffectiveSecuritySettingsSync() {
  const settings = adminSettingsCache || getDefaultAdminSecuritySettings();
  return {
    apiKeyAuthEnabled: Boolean(settings.apiKeyAuthEnabled),
    apiKeyHeaderName: String(settings.apiKeyHeaderName || "x-api-key").trim().toLowerCase() || "x-api-key",
    apiKeys: normalizeApiKeyList(settings.apiKeys),
    apiKeyProtectedPathPrefixes: normalizePathPrefixList(settings.apiKeyProtectedPathPrefixes),
    apiKeyExemptPathPrefixes: normalizePathPrefixList(settings.apiKeyExemptPathPrefixes),
    apiKeyRequireHeaderOnly: settings.apiKeyRequireHeaderOnly !== false,
    agentMaxStepsOverrideCode: String(settings.agentMaxStepsOverrideCode || "").trim(),
    workspaceUploadBypassCodes: parseWorkspaceUploadBypassCodes(settings.workspaceUploadBypassCodesRaw)
  };
}

function parseCookieHeader(headerValue) {
  const source = String(headerValue || "");
  const out = {};
  for (const item of source.split(";")) {
    const idx = item.indexOf("=");
    if (idx < 0) {
      continue;
    }
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    if (!key) {
      continue;
    }
    out[key] = decodeURIComponent(value || "");
  }
  return out;
}

function normalizeApiPathPrefix(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const noQuery = raw.split("?")[0] || "";
  const normalized = noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  return normalized.replace(/\/+$/, "") || "/";
}

function pathMatchesAnyPrefix(pathname, prefixes) {
  const pathValue = normalizeApiPathPrefix(pathname);
  if (!pathValue || !Array.isArray(prefixes) || prefixes.length === 0) {
    return false;
  }

  for (const prefixRaw of prefixes) {
    const prefix = normalizeApiPathPrefix(prefixRaw);
    if (!prefix) {
      continue;
    }
    if (pathValue === prefix || pathValue.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

function workspaceContextForCode(codeValue) {
  const workspaceCode = normalizeWorkspaceCode(codeValue) || defaultWorkspaceCode;
  const root = path.resolve(sandboxBaseRoot, "workspaces", workspaceCode);
  const bareRepoPath = path.resolve(workspaceGitRemoteRoot, `${workspaceCode}.git`);
  return {
    code: workspaceCode,
    sandboxRoot: root,
    auditLogPath: path.join(root, ".audit-log.jsonl"),
    bareRepoPath
  };
}

function getWorkspaceContext() {
  return workspaceContextStore.getStore() || workspaceContextForCode(defaultWorkspaceCode);
}

function getSandboxRoot() {
  return getWorkspaceContext().sandboxRoot;
}

function getAuditLogPath() {
  return getWorkspaceContext().auditLogPath;
}

function setWorkspaceCookie(res, code) {
  const encoded = encodeURIComponent(code);
  const cookieValue = `${workspaceCookieName}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookieValue);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookieValue]);
    return;
  }
  res.setHeader("Set-Cookie", [String(existing), cookieValue]);
}

function resolveRequestedWorkspaceCode(req) {
  const queryCode = normalizeWorkspaceCode(req.query?.access_code || req.query?.workspace || req.query?.code);
  const headerCode = normalizeWorkspaceCode(req.headers["x-workspace-code"]);
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const cookieCode = normalizeWorkspaceCode(cookies[workspaceCookieName]);
  const resolved = queryCode || headerCode || cookieCode || defaultWorkspaceCode;

  if (allowedWorkspaceCodes.length > 0 && !allowedWorkspaceCodes.includes(resolved)) {
    return null;
  }

  return resolved;
}

function getUploadBypassCode(req) {
  const headerCode = normalizeUploadBypassCode(req.headers["x-upload-bypass-code"] || "");
  const queryCode = normalizeUploadBypassCode(req.query?.upload_code || "");
  return headerCode || queryCode || "";
}

function isUploadLimitBypassAllowed(req) {
  const workspace = getWorkspaceContext().code;
  const security = getEffectiveSecuritySettingsSync();
  const expectedCode = security.workspaceUploadBypassCodes.get(workspace);
  if (!expectedCode) {
    return false;
  }
  const provided = getUploadBypassCode(req);
  return Boolean(provided) && provided === expectedCode;
}

function createUploadMiddlewareForRequest(req) {
  const bypass = isUploadLimitBypassAllowed(req);
  return multer({
    storage: multer.memoryStorage(),
    limits: bypass ? undefined : { fileSize: defaultUploadMaxBytes }
  }).any();
}

function getChunkUploadRoot() {
  return path.join(getSandboxRoot(), ".upload-sessions");
}

function makeUploadSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupExpiredUploadSessions() {
  const now = Date.now();
  for (const [id, session] of uploadSessionStore.entries()) {
    if (now - Number(session?.updatedAt || 0) < chunkUploadSessionMaxAgeMs) {
      continue;
    }
    uploadSessionStore.delete(id);
    if (session?.tempPath) {
      fsp.unlink(session.tempPath).catch(() => {});
    }
  }
}

function getUploadSessionOrThrow(uploadId) {
  cleanupExpiredUploadSessions();
  const session = uploadSessionStore.get(uploadId);
  if (!session) {
    throw new Error("upload session not found or expired");
  }
  const workspace = getWorkspaceContext().code;
  if (session.workspaceCode !== workspace) {
    throw new Error("upload session belongs to a different workspace");
  }
  session.updatedAt = Date.now();
  return session;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value == null) {
    return [];
  }
  return [value];
}

function resolveSandboxPath(inputPath = "") {
  const sandboxRoot = getSandboxRoot();
  const rel = normalizeSandboxRelativePath(inputPath);
  const absolute = path.resolve(sandboxRoot, rel);
  const sandboxPrefix = `${sandboxRoot}${path.sep}`;
  if (absolute !== sandboxRoot && !absolute.startsWith(sandboxPrefix)) {
    throw new Error("path escapes sandbox");
  }
  return { rel, absolute };
}

async function runGit(args, allowFail = false) {
  const sandboxRoot = getSandboxRoot();
  try {
    return await execFileAsync("git", args, { cwd: sandboxRoot });
  } catch (error) {
    if (allowFail) {
      return {
        stdout: String(error?.stdout || ""),
        stderr: String(error?.stderr || ""),
        code: Number(error?.code || 1)
      };
    }
    throw error;
  }
}

async function runGitInRepo(repoRoot, args, allowFail = false) {
  try {
    return await execFileAsync("git", args, { cwd: repoRoot });
  } catch (error) {
    if (allowFail) {
      return {
        stdout: String(error?.stdout || ""),
        stderr: String(error?.stderr || ""),
        code: Number(error?.code || 1)
      };
    }
    throw error;
  }
}

function getWorkspaceGitRemoteName() {
  return workspaceGitRemoteName;
}

function getWorkspaceBareRepoPath() {
  return getWorkspaceContext().bareRepoPath;
}

function getWorkspaceBareRepoSshUrl(req) {
  const hostFromReq = String(req?.headers?.host || "").split(":")[0].trim();
  const host = workspaceGitSshHost || hostFromReq;
  if (!host) {
    return "";
  }
  const repoPath = getWorkspaceBareRepoPath().replaceAll("\\", "/");
  return `${workspaceGitSshUser}@${host}:${repoPath}`;
}

async function ensureWorkspaceGitRemoteSetup(req = null) {
  const bareRepoPath = getWorkspaceBareRepoPath();
  await fsp.mkdir(path.dirname(bareRepoPath), { recursive: true });
  if (!fs.existsSync(path.join(bareRepoPath, "HEAD"))) {
    await execFileAsync("git", ["init", "--bare", bareRepoPath]);
  }

  const remoteName = getWorkspaceGitRemoteName();
  const setResult = await runGit(["remote", "set-url", remoteName, bareRepoPath], true);
  if (setResult.code && setResult.code !== 0) {
    const addResult = await runGit(["remote", "add", remoteName, bareRepoPath], true);
    const addErr = String(addResult?.stderr || "");
    if (addResult.code && addResult.code !== 0 && !/already exists/i.test(addErr)) {
      throw new Error(addErr || "failed to configure workspace git remote");
    }
    if (/already exists/i.test(addErr)) {
      const retrySet = await runGit(["remote", "set-url", remoteName, bareRepoPath], true);
      if (retrySet.code && retrySet.code !== 0) {
        throw new Error(String(retrySet.stderr || "failed to update workspace git remote"));
      }
    }
  }

  return {
    remoteName,
    remotePath: bareRepoPath,
    remoteSshUrl: getWorkspaceBareRepoSshUrl(req)
  };
}

async function pullWorkspaceFromRemote({ remoteName, branch, strategy }) {
  const chosenRemote = String(remoteName || getWorkspaceGitRemoteName()).trim() || getWorkspaceGitRemoteName();
  const chosenBranch = String(branch || "main").trim() || "main";
  const chosenStrategy = String(strategy || "ff-only").trim().toLowerCase();
  await runGit(["fetch", chosenRemote]);

  if (chosenStrategy === "hard-reset") {
    await runGit(["checkout", "-B", chosenBranch, `${chosenRemote}/${chosenBranch}`]);
  } else if (chosenStrategy === "rebase") {
    await runGit(["pull", "--rebase", chosenRemote, chosenBranch]);
  } else {
    await runGit(["pull", "--ff-only", chosenRemote, chosenBranch]);
  }

  return {
    ok: true,
    remote: chosenRemote,
    branch: chosenBranch,
    strategy: chosenStrategy,
    head: String((await runGit(["rev-parse", "--short", "HEAD"]))?.stdout || "").trim()
  };
}

async function pushWorkspaceToRemote({ remoteName, branch, setUpstream, forceWithLease }) {
  const chosenRemote = String(remoteName || getWorkspaceGitRemoteName()).trim() || getWorkspaceGitRemoteName();
  const currentBranch = await getCurrentBranchName();
  const chosenBranch = String(branch || currentBranch || "main").trim() || "main";
  const args = ["push"];
  if (setUpstream !== false) {
    args.push("-u");
  }
  if (Boolean(forceWithLease)) {
    args.push("--force-with-lease");
  }
  args.push(chosenRemote, chosenBranch);
  const result = await runGit(args, true);
  return {
    ok: !result.code,
    remote: chosenRemote,
    branch: chosenBranch,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim()
  };
}

function utcDateStamp(dateValue = new Date()) {
  return dateValue.toISOString().slice(0, 10);
}

function getAutoSessionBranchName(workspaceCode, dateValue = new Date()) {
  return `${sessionBranchPrefix}/${workspaceCode}-${utcDateStamp(dateValue)}`;
}

function isValidBranchName(value) {
  const branch = String(value || "").trim();
  if (!branch) {
    return false;
  }
  if (branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{") || branch.endsWith(".")) {
    return false;
  }
  return /^[a-zA-Z0-9._/-]{2,120}$/.test(branch);
}

async function getCurrentBranchName() {
  const result = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], true);
  const branch = String(result?.stdout || "").trim();
  return branch || "";
}

async function switchWorkspaceBranch(branchName, createIfMissing = true) {
  const target = String(branchName || "").trim();
  if (!isValidBranchName(target)) {
    throw new Error("invalid branch name");
  }

  const existsResult = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${target}`], true);
  if (existsResult.code === 0) {
    await runGit(["checkout", target]);
  } else {
    if (!createIfMissing) {
      throw new Error(`branch '${target}' does not exist`);
    }
    const createResult = await runGit(["checkout", "-b", target], true);
    if (createResult.code && createResult.code !== 0) {
      const stderr = String(createResult.stderr || "");
      if (/already exists/i.test(stderr)) {
        await runGit(["checkout", target]);
      } else {
        throw new Error(stderr || `failed to create branch '${target}'`);
      }
    }
  }

  const workspace = getWorkspaceContext();
  workspaceBranchState.set(workspace.code, target);
  return target;
}

async function ensureWorkspaceSessionBranch() {
  if (!enableAutoSessionBranching) {
    return null;
  }

  const workspace = getWorkspaceContext();
  const targetBranch = getAutoSessionBranchName(workspace.code);
  const currentBranch = await getCurrentBranchName();
  const cached = workspaceBranchState.get(workspace.code);
  if (cached === targetBranch && currentBranch === targetBranch) {
    return targetBranch;
  }

  await switchWorkspaceBranch(targetBranch, true);
  return targetBranch;
}

async function listWorkspaceRepositories() {
  const workspacesRoot = path.join(sandboxBaseRoot, "workspaces");
  await fsp.mkdir(workspacesRoot, { recursive: true });
  const entries = await fsp.readdir(workspacesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      code: entry.name,
      root: path.join(workspacesRoot, entry.name)
    }));
}

async function pruneOldWorkspaceBackups(backupDir) {
  const retentionMs = workspaceBackupRetentionDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const entries = await fsp.readdir(backupDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".bundle")) {
      continue;
    }
    const fullPath = path.join(backupDir, entry.name);
    const stat = await fsp.stat(fullPath).catch(() => null);
    if (!stat) {
      continue;
    }
    if (stat.mtimeMs < cutoff) {
      await fsp.rm(fullPath, { force: true }).catch(() => {});
    }
  }
}

async function backupWorkspaceRepository(code, repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  if (!fs.existsSync(gitDir)) {
    return { code, skipped: true, reason: "no-git" };
  }

  const backupDir = path.join(workspaceBackupRoot, code);
  await fsp.mkdir(backupDir, { recursive: true });
  const bundlePath = path.join(backupDir, `${utcDateStamp()}.bundle`);
  const result = await runGitInRepo(repoRoot, ["bundle", "create", bundlePath, "--all"], true);
  if (result.code && result.code !== 0) {
    return {
      code,
      skipped: true,
      reason: "bundle-failed",
      stderr: String(result.stderr || "").slice(0, 240)
    };
  }

  await pruneOldWorkspaceBackups(backupDir);
  return { code, ok: true, bundlePath };
}

async function runNightlyWorkspaceBackups() {
  const repos = await listWorkspaceRepositories();
  const summary = [];
  for (const repo of repos) {
    const item = await backupWorkspaceRepository(repo.code, repo.root);
    summary.push(item);
  }
  return summary;
}

function msUntilNextUtcHour(hour) {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

function scheduleNightlyWorkspaceBackups() {
  if (!enableNightlyWorkspaceBackup) {
    return;
  }

  const runAndReschedule = async () => {
    try {
      const results = await runNightlyWorkspaceBackups();
      const okCount = results.filter((item) => item.ok).length;
      const skippedCount = results.length - okCount;
      console.log(`Nightly workspace backup completed: ok=${okCount}, skipped=${skippedCount}`);
    } catch (error) {
      console.error("Nightly workspace backup failed:", String(error?.message || error));
    } finally {
      workspaceBackupTimer = setTimeout(runAndReschedule, 24 * 60 * 60 * 1000);
    }
  };

  const initialDelay = msUntilNextUtcHour(workspaceBackupUtcHour);
  workspaceBackupTimer = setTimeout(runAndReschedule, initialDelay);
  console.log(`Nightly workspace backup scheduled for UTC hour ${workspaceBackupUtcHour}.`);
}

async function ensureSandboxReady() {
  const { code, sandboxRoot, auditLogPath } = getWorkspaceContext();
  if (workspaceReadyPromises.has(code)) {
    return workspaceReadyPromises.get(code);
  }

  const readyPromise = (async () => {
  await fsp.mkdir(sandboxRoot, { recursive: true });
  if (!fs.existsSync(auditLogPath)) {
    await fsp.writeFile(auditLogPath, "", "utf8");
  }

  const gitDirPath = path.join(sandboxRoot, ".git");
  if (!fs.existsSync(gitDirPath)) {
    await runGit(["init"]);
    await runGit(["config", "user.name", gitUserName]);
    await runGit(["config", "user.email", gitUserEmail]);
    await runGit(["checkout", "-B", "main"], true);
    await runGit(["add", "-A"]);
    await runGit(["commit", "--allow-empty", "-m", "Initialize sandbox"]);
  }

  await ensureWorkspaceGitRemoteSetup();
  })();

  workspaceReadyPromises.set(code, readyPromise);
  return readyPromise;
}

async function commitSandboxSnapshot(message) {
  await runGit(["add", "-A"]);
  const result = await runGit(["commit", "-m", message], true);
  const nothingToCommit = /nothing to commit|no changes added/i.test(result.stderr || "");
  if (!nothingToCommit && result.code && result.code !== 0) {
    throw new Error(result.stderr || "git commit failed");
  }
}

function createTraceId() {
  return `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveRequestTraceId(req) {
  const fromReq = String(req?.traceId || "").trim();
  if (fromReq) {
    return fromReq;
  }
  const fromHeader = String(req?.headers?.["x-trace-id"] || req?.headers?.["x-request-id"] || "").trim();
  if (fromHeader) {
    return fromHeader.slice(0, 120);
  }
  const fromBody = String(req?.body?.traceId || "").trim();
  if (fromBody) {
    return fromBody.slice(0, 120);
  }
  return "";
}

function isSensitiveKeyName(keyPath) {
  return /(authorization|api[_-]?key|token|secret|password|passwd|cookie|session|bearer|private[_-]?key|client[_-]?secret)/i.test(String(keyPath || ""));
}

function looksSensitiveString(value) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  if (/^bearer\s+/i.test(text)) {
    return true;
  }
  if (/^sk-[A-Za-z0-9]/.test(text)) {
    return true;
  }
  if (/gh[pousr]_[A-Za-z0-9_]+/i.test(text)) {
    return true;
  }
  if (/-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(text)) {
    return true;
  }
  return false;
}

function redactString(value) {
  const text = String(value || "");
  if (!text) {
    return "[redacted]";
  }
  const visible = Math.min(4, Math.max(0, text.length - 4));
  if (visible <= 0) {
    return "[redacted]";
  }
  return `[redacted:${text.slice(0, visible)}...len=${text.length}]`;
}

async function appendAuditLog(req, operation, details = {}) {
  const auditLogPath = getAuditLogPath();
  const workspace = getWorkspaceContext();
  const entry = {
    timestamp: new Date().toISOString(),
    operation,
    traceId: resolveRequestTraceId(req) || createTraceId(),
    workspaceCode: workspace.code,
    ip: req.ip,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
    details: sanitizeAuditPayload(details)
  };
  try {
    await fsp.appendFile(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
    const now = Date.now();
    if (now - lastAuditRetentionRunAt > auditRetentionPruneIntervalMs) {
      lastAuditRetentionRunAt = now;
      await pruneAuditEntries();
    }
  } catch (error) {
    console.error("Failed to append audit log:", error?.message || error);
  }
}

function sanitizeAuditPayload(value, depth = 0, keyPath = "") {
  if (value == null) {
    return value;
  }
  if (depth > 6) {
    return "[depth-limit]";
  }
  const type = typeof value;
  if (type === "number" || type === "boolean") {
    return value;
  }
  if (type === "string") {
    if (isSensitiveKeyName(keyPath) || looksSensitiveString(value)) {
      return redactString(value);
    }
    return value.length > 2000 ? `${value.slice(0, 2000)}...[truncated]` : value;
  }
  if (Array.isArray(value)) {
    const limited = value.slice(0, 50).map((item, index) => sanitizeAuditPayload(item, depth + 1, `${keyPath}[${index}]`));
    if (value.length > 50) {
      limited.push(`[+${value.length - 50} more items]`);
    }
    return limited;
  }
  if (type === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, 80);
    for (const [key, item] of entries) {
      const nextPath = keyPath ? `${keyPath}.${key}` : key;
      if (isSensitiveKeyName(nextPath)) {
        out[key] = redactString(item);
      } else {
        out[key] = sanitizeAuditPayload(item, depth + 1, nextPath);
      }
    }
    const remaining = Object.keys(value).length - entries.length;
    if (remaining > 0) {
      out.__truncatedKeys = remaining;
    }
    return out;
  }
  return String(value);
}

function pruneChatJobs() {
  const now = Date.now();
  for (const [id, job] of chatJobStore.entries()) {
    const age = now - Number(new Date(job.updatedAt || job.createdAt || 0).getTime() || 0);
    if (age > chatJobMaxAgeMs) {
      closeChatJobStreams(job);
      chatJobStore.delete(id);
    }
  }

  if (chatJobStore.size <= chatJobMaxEntries) {
    return;
  }

  const sorted = [...chatJobStore.values()]
    .sort((a, b) => Number(new Date(a.createdAt).getTime()) - Number(new Date(b.createdAt).getTime()));
  const removeCount = chatJobStore.size - chatJobMaxEntries;
  for (let i = 0; i < removeCount; i += 1) {
    const id = sorted[i]?.id;
    if (id) {
      closeChatJobStreams(chatJobStore.get(id));
      chatJobStore.delete(id);
    }
  }
}

function createChatJob(req, provider, agentMode) {
  pruneChatJobs();
  const id = `job-${Date.now()}-${chatJobCounter++}`;
  const traceId = resolveRequestTraceId(req) || createTraceId();
  const workspace = getWorkspaceContext();
  const createdAt = new Date().toISOString();
  const job = {
    id,
    traceId,
    status: "queued",
    provider,
    agentMode: Boolean(agentMode),
    workspaceCode: workspace.code,
    createdAt,
    updatedAt: createdAt,
    cancelRequested: false,
    cancelledAt: null,
    listeners: new Set(),
    events: [],
    abortController: null,
    result: null,
    error: null
  };
  recordChatJobEvent(job, "queued", { provider, agentMode: Boolean(agentMode), traceId });
  chatJobStore.set(id, job);
  return job;
}

function recordChatJobEvent(job, type, payload = {}) {
  if (!job) {
    return;
  }
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId: job.id,
    traceId: job.traceId,
    type: String(type || "event"),
    timestamp: new Date().toISOString(),
    payload: sanitizeAuditPayload(payload)
  };
  job.events.push(event);
  if (job.events.length > chatJobEventHistoryMax) {
    job.events.splice(0, job.events.length - chatJobEventHistoryMax);
  }

  const lines = [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    ""
  ].join("\n");
  for (const stream of job.listeners) {
    try {
      stream.write(lines);
    } catch {
      // Ignore broken streams.
    }
  }
}

function closeChatJobStreams(job) {
  if (!job || !(job.listeners instanceof Set)) {
    return;
  }
  for (const stream of job.listeners) {
    try {
      stream.end();
    } catch {
      // Ignore stream close errors.
    }
  }
  job.listeners.clear();
}

function setChatJobStatus(job, status, extra = {}) {
  if (!job) {
    return;
  }
  job.status = status;
  job.updatedAt = new Date().toISOString();
  if (Object.prototype.hasOwnProperty.call(extra, "result")) {
    job.result = extra.result;
  }
  if (Object.prototype.hasOwnProperty.call(extra, "error")) {
    job.error = extra.error;
  }
  if (Object.prototype.hasOwnProperty.call(extra, "cancelRequested")) {
    job.cancelRequested = Boolean(extra.cancelRequested);
  }
  if (Object.prototype.hasOwnProperty.call(extra, "cancelledAt")) {
    job.cancelledAt = extra.cancelledAt;
  }
  recordChatJobEvent(job, status, extra.eventPayload || {});
  if (["completed", "failed", "cancelled"].includes(status)) {
    closeChatJobStreams(job);
  }
}

function cancelChatJob(job, reason = "Cancelled by user") {
  if (!job) {
    return false;
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return false;
  }
  if (job.abortController) {
    try {
      job.abortController.abort(reason);
    } catch {
      // Ignore abort errors.
    }
  }

  setChatJobStatus(job, "cancelled", {
    cancelRequested: true,
    cancelledAt: new Date().toISOString(),
    error: {
      message: reason,
      status: 499,
      cancelled: true
    },
    eventPayload: { reason }
  });
  return true;
}

function getChatJobResponse(job) {
  if (!job) {
    return null;
  }
  return {
    id: job.id,
    traceId: job.traceId,
    status: job.status,
    provider: job.provider,
    agentMode: job.agentMode,
    workspaceCode: job.workspaceCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    cancelRequested: Boolean(job.cancelRequested),
    cancelledAt: job.cancelledAt || null,
    result: job.status === "completed" ? job.result : null,
    error: ["failed", "cancelled"].includes(job.status) ? job.error : null
  };
}

async function pruneAuditEntries() {
  const auditLogPath = getAuditLogPath();
  if (!fs.existsSync(auditLogPath)) {
    return;
  }

  const raw = await fsp.readFile(auditLogPath, "utf8");
  if (!raw) {
    return;
  }

  const cutoffMs = Date.now() - (auditRetentionDays * 24 * 60 * 60 * 1000);
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const kept = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const tsMs = Number(new Date(parsed?.timestamp || 0).getTime() || 0);
      if (tsMs && tsMs < cutoffMs) {
        continue;
      }
      kept.push(line);
    } catch {
      // Drop malformed lines during retention compaction.
    }
  }

  let totalBytes = 0;
  const byBytes = [];
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const line = kept[i];
    totalBytes += Buffer.byteLength(line, "utf8") + 1;
    if (totalBytes > auditLogMaxBytes) {
      break;
    }
    byBytes.push(line);
  }
  byBytes.reverse();

  const compacted = byBytes.length > 0 ? `${byBytes.join("\n")}\n` : "";
  await fsp.writeFile(auditLogPath, compacted, "utf8");
}

async function readAuditEntries(limitOrOptions = 200) {
  const isLegacyNumeric = typeof limitOrOptions === "number";
  const options = isLegacyNumeric
    ? { limit: limitOrOptions }
    : (limitOrOptions && typeof limitOrOptions === "object" ? limitOrOptions : {});
  const auditLogPath = getAuditLogPath();
  if (!fs.existsSync(auditLogPath)) {
    return isLegacyNumeric
      ? []
      : { entries: [], hasMore: false, nextBefore: null };
  }

  const text = await fsp.readFile(auditLogPath, "utf8");
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 200)));
  const beforeRaw = String(options.before || "").trim();
  const beforeMs = beforeRaw ? Number(new Date(beforeRaw).getTime() || 0) : 0;

  const parsed = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();

  const filtered = beforeMs > 0
    ? parsed.filter((entry) => {
      const entryMs = Number(new Date(entry?.timestamp || 0).getTime() || 0);
      return entryMs > 0 && entryMs < beforeMs;
    })
    : parsed;

  const page = filtered.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const entries = hasMore ? page.slice(0, limit) : page;
  const nextBefore = hasMore ? String(entries[entries.length - 1]?.timestamp || "") || null : null;

  if (isLegacyNumeric) {
    return entries;
  }
  return { entries, hasMore, nextBefore };
}

function detectPrettierParser(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".js", ".mjs", ".cjs"].includes(ext)) return "babel";
  if (ext === ".jsx") return "babel";
  if (ext === ".ts") return "typescript";
  if (ext === ".tsx") return "typescript";
  if (ext === ".json") return "json";
  if (ext === ".css") return "css";
  if (ext === ".html") return "html";
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if ([".yaml", ".yml"].includes(ext)) return "yaml";
  return null;
}

function basicPythonFormat(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const trimmedTrailing = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  return trimmedTrailing.endsWith("\n") ? trimmedTrailing : `${trimmedTrailing}\n`;
}

function basicTextFormat(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const trimmedTrailing = normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
  return trimmedTrailing.endsWith("\n") ? trimmedTrailing : `${trimmedTrailing}\n`;
}

function isCExt(ext) {
  return [".c", ".h"].includes(String(ext || "").toLowerCase());
}

function isCppExt(ext) {
  return [".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"].includes(String(ext || "").toLowerCase());
}

function isTclExt(ext) {
  return [".tcl", ".tk"].includes(String(ext || "").toLowerCase());
}

function isQmlExt(ext) {
  return [".qml", ".qmltypes", ".qrc"].includes(String(ext || "").toLowerCase());
}

function isSynopterExt(ext) {
  return [".syn", ".synopter", ".ccs5", ".spt"].includes(String(ext || "").toLowerCase());
}

async function runCommandWithCandidates(candidates, args, options = {}) {
  let lastErr;
  for (const cmd of candidates) {
    try {
      const result = await execFileAsync(cmd, args, options);
      return { cmd, ...result };
    } catch (error) {
      if (error?.code === "ENOENT") {
        lastErr = error;
        continue;
      }
      throw error;
    }
  }
  throw lastErr || new Error(`command not found: ${candidates.join(", ")}`);
}

async function runPythonCommand(args, options = {}) {
  return runCommandWithCandidates(["python", "python3"], args, options);
}

async function formatPythonText(content) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-pyfmt-"));
  const tempFile = path.join(tempDir, "format_target.py");
  const original = String(content || "");

  try {
    await fsp.writeFile(tempFile, original, "utf8");
    try {
      await runPythonCommand(["-m", "black", "--quiet", tempFile], { timeout: 20000 });
      const formatted = await fsp.readFile(tempFile, "utf8");
      return { ok: true, parser: "black", formatted };
    } catch (error) {
      const stderr = String(error?.stderr || error?.message || "");
      const missingBlack = /No module named black|No module named 'black'|ModuleNotFoundError/i.test(stderr);
      if (!missingBlack) {
        throw new Error(`Python format failed: ${stderr}`);
      }
      return { ok: true, parser: "python-basic", formatted: basicPythonFormat(original) };
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function formatCCppText(content, ext) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-cfmt-"));
  const suffix = isCppExt(ext) ? ".cpp" : ".c";
  const tempFile = path.join(tempDir, `format_target${suffix}`);
  const original = String(content || "");

  try {
    await fsp.writeFile(tempFile, original, "utf8");
    try {
      await runCommandWithCandidates(["clang-format"], ["-i", tempFile], { timeout: 20000 });
      const formatted = await fsp.readFile(tempFile, "utf8");
      return { ok: true, parser: "clang-format", formatted };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { ok: true, parser: "c-basic", formatted: basicTextFormat(original) };
      }
      throw new Error(`C/C++ format failed: ${String(error?.stderr || error?.message || "unknown error")}`);
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function formatTclText(content) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-tclfmt-"));
  const tempFile = path.join(tempDir, "format_target.tcl");
  const original = String(content || "");

  try {
    await fsp.writeFile(tempFile, original, "utf8");
    try {
      const result = await runCommandWithCandidates(["tclfmt"], [tempFile], { timeout: 20000 });
      const stdout = String(result?.stdout || "");
      const formatted = stdout.trim() ? stdout : await fsp.readFile(tempFile, "utf8");
      return { ok: true, parser: "tclfmt", formatted };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { ok: true, parser: "tcl-basic", formatted: basicTextFormat(original) };
      }
      throw new Error(`Tcl format failed: ${String(error?.stderr || error?.message || "unknown error")}`);
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function lineColFromOffset(text, offsetValue) {
  const offset = Math.max(0, Math.min(Number(offsetValue || 0), String(text || "").length));
  const source = String(text || "");
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: (lines[lines.length - 1] || "").length + 1
  };
}

async function lintPythonText(content) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-pylint-"));
  const tempFile = path.join(tempDir, "lint_target.py");
  const text = String(content || "");

  try {
    await fsp.writeFile(tempFile, text, "utf8");
    try {
      await runPythonCommand(["-m", "py_compile", tempFile], { timeout: 20000 });
      return { ok: true, path: "<python>", issueCount: 0, messages: [] };
    } catch (error) {
      const stderr = String(error?.stderr || error?.message || "");
      const lineMatch = /line\s+(\d+)/i.exec(stderr);
      const line = Number(lineMatch?.[1] || 1);
      return {
        ok: true,
        path: "<python>",
        issueCount: 1,
        messages: [
          {
            ruleId: "py_compile",
            severity: "error",
            line,
            column: 1,
            message: stderr.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "Python syntax error"
          }
        ]
      };
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function lintJsonText(content) {
  const text = String(content || "");
  try {
    JSON.parse(text);
    return { ok: true, path: "<json>", issueCount: 0, messages: [] };
  } catch (error) {
    const msg = String(error?.message || "Invalid JSON");
    const posMatch = /position\s+(\d+)/i.exec(msg);
    const loc = lineColFromOffset(text, Number(posMatch?.[1] || 0));
    return {
      ok: true,
      path: "<json>",
      issueCount: 1,
      messages: [
        {
          ruleId: "json.parse",
          severity: "error",
          line: loc.line,
          column: loc.column,
          message: msg
        }
      ]
    };
  }
}

function parseCompilerDiagnostics(stderrText) {
  const lines = String(stderrText || "").split(/\r?\n/).filter(Boolean);
  const messages = [];

  for (const line of lines) {
    const match = /:(\d+):(\d+):\s*(warning|error|fatal error):\s*(.+)$/i.exec(line);
    if (!match) {
      continue;
    }
    const severityRaw = String(match[3] || "error").toLowerCase();
    messages.push({
      ruleId: "compiler",
      severity: severityRaw.includes("warning") ? "warning" : "error",
      line: Number(match[1] || 1),
      column: Number(match[2] || 1),
      message: String(match[4] || "compiler diagnostic").trim()
    });
  }

  if (messages.length > 0) {
    return messages;
  }

  const fallback = String(stderrText || "").split(/\r?\n/).filter(Boolean).slice(-1)[0] || "Compilation failed";
  return [{
    ruleId: "compiler",
    severity: "error",
    line: 1,
    column: 1,
    message: fallback
  }];
}

async function lintCCppText(content, ext) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-clint-"));
  const suffix = isCppExt(ext) ? ".cpp" : ".c";
  const tempFile = path.join(tempDir, `lint_target${suffix}`);
  const code = String(content || "");

  const compilerCandidates = isCppExt(ext) ? ["g++", "clang++"] : ["gcc", "clang"];
  try {
    await fsp.writeFile(tempFile, code, "utf8");
    try {
      await runCommandWithCandidates(compilerCandidates, ["-fsyntax-only", tempFile], { timeout: 20000 });
      return { ok: true, path: "<c-cpp>", issueCount: 0, messages: [] };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          ok: true,
          path: "<c-cpp>",
          issueCount: 1,
          messages: [{
            ruleId: "compiler.missing",
            severity: "warning",
            line: 1,
            column: 1,
            message: `No compiler found (${compilerCandidates.join(" or ")}). Install one for full C/C++ linting.`
          }]
        };
      }
      const messages = parseCompilerDiagnostics(String(error?.stderr || error?.message || ""));
      return { ok: true, path: "<c-cpp>", issueCount: messages.length, messages };
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function lintTclText(content) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-tcllint-"));
  const targetFile = path.join(tempDir, "lint_target.tcl");
  const checkerFile = path.join(tempDir, "lint_checker.tcl");
  const code = String(content || "");

  const checkerScript = [
    "set f [open [lindex $argv 0] r]",
    "set s [read $f]",
    "close $f",
    "if {[info complete $s]} {exit 0}",
    "puts stderr \"Tcl script appears incomplete (brace/quote imbalance)\"",
    "exit 1"
  ].join("\n");

  try {
    await fsp.writeFile(targetFile, code, "utf8");
    await fsp.writeFile(checkerFile, checkerScript, "utf8");
    try {
      await runCommandWithCandidates(["tclsh"], [checkerFile, targetFile], { timeout: 20000 });
      return { ok: true, path: "<tcl>", issueCount: 0, messages: [] };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          ok: true,
          path: "<tcl>",
          issueCount: 1,
          messages: [{
            ruleId: "tclsh.missing",
            severity: "warning",
            line: 1,
            column: 1,
            message: "tclsh not found. Install Tcl for full Tcl linting."
          }]
        };
      }
      const stderr = String(error?.stderr || error?.message || "");
      const message = stderr.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "Tcl lint failed";
      return {
        ok: true,
        path: "<tcl>",
        issueCount: 1,
        messages: [{
          ruleId: "tcl.basic",
          severity: "error",
          line: 1,
          column: 1,
          message
        }]
      };
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function lintStructuredText(content, options = {}) {
  const text = String(content || "");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const openers = new Set(["{", "[", "("]);
  const closers = { "}": "{", "]": "[", ")": "(" };
  const stack = [];
  const messages = [];

  let inBlockComment = false;
  let inString = "";
  let stringStart = { line: 1, column: 1 };

  const hasLineHashComment = options.hashComment !== false;
  const hasLineSlashComment = options.slashComment !== false;
  const hasBlockComment = options.blockComment !== false;

  for (let li = 0; li < lines.length; li += 1) {
    const line = lines[li] || "";
    let i = 0;

    while (i < line.length) {
      const ch = line[i];
      const next = line[i + 1] || "";

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }

      if (inString) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === inString) {
          inString = "";
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }

      if (hasLineHashComment && ch === "#") {
        break;
      }
      if (hasLineSlashComment && ch === "/" && next === "/") {
        break;
      }
      if (hasBlockComment && ch === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }

      if (ch === '"' || ch === "'") {
        inString = ch;
        stringStart = { line: li + 1, column: i + 1 };
        i += 1;
        continue;
      }

      if (openers.has(ch)) {
        stack.push({ ch, line: li + 1, column: i + 1 });
        i += 1;
        continue;
      }

      if (closers[ch]) {
        const expected = closers[ch];
        const top = stack[stack.length - 1];
        if (!top || top.ch !== expected) {
          messages.push({
            ruleId: "structure.mismatch",
            severity: "error",
            line: li + 1,
            column: i + 1,
            message: `Unexpected '${ch}'`
          });
        } else {
          stack.pop();
        }
      }

      i += 1;
    }

    if (line.length > 220) {
      messages.push({
        ruleId: "style.line-length",
        severity: "warning",
        line: li + 1,
        column: 221,
        message: "Line exceeds 220 characters"
      });
    }
  }

  if (inBlockComment) {
    messages.push({
      ruleId: "structure.comment",
      severity: "error",
      line: lines.length,
      column: Math.max(1, (lines[lines.length - 1] || "").length),
      message: "Unclosed block comment"
    });
  }

  if (inString) {
    messages.push({
      ruleId: "structure.string",
      severity: "error",
      line: stringStart.line,
      column: stringStart.column,
      message: "Unclosed string literal"
    });
  }

  while (stack.length > 0) {
    const unclosed = stack.pop();
    messages.push({
      ruleId: "structure.unclosed",
      severity: "error",
      line: unclosed.line,
      column: unclosed.column,
      message: `Unclosed '${unclosed.ch}'`
    });
  }

  return messages;
}

function parseQmlLintDiagnostics(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const messages = [];

  for (const line of lines) {
    const match = /:(\d+):(\d+):\s*(warning|error|info):\s*(.+)$/i.exec(line);
    if (!match) {
      continue;
    }
    const sev = String(match[3] || "error").toLowerCase();
    messages.push({
      ruleId: "qmllint",
      severity: sev.includes("error") ? "error" : "warning",
      line: Number(match[1] || 1),
      column: Number(match[2] || 1),
      message: String(match[4] || "QML diagnostic").trim()
    });
  }

  if (messages.length > 0) {
    return messages;
  }

  const fallback = lines.slice(-1)[0] || "QML lint failed";
  return [{
    ruleId: "qmllint",
    severity: "error",
    line: 1,
    column: 1,
    message: fallback
  }];
}

async function lintQmlText(content) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-qmllint-"));
  const tempFile = path.join(tempDir, "lint_target.qml");
  const code = String(content || "");

  try {
    await fsp.writeFile(tempFile, code, "utf8");
    try {
      await runCommandWithCandidates(["qmllint"], [tempFile], { timeout: 20000 });
      return { ok: true, path: "<qml>", issueCount: 0, messages: [] };
    } catch (error) {
      const stderr = String(error?.stderr || error?.stdout || error?.message || "");
      const missingQmlLint = error?.code === "ENOENT" || /qmllint.*No such file or directory/i.test(stderr);
      if (missingQmlLint) {
        const basicMessages = lintStructuredText(code, {
          hashComment: false,
          slashComment: true,
          blockComment: true
        });
        if (basicMessages.length > 0) {
          return { ok: true, path: "<qml>", issueCount: basicMessages.length, messages: basicMessages };
        }
        return {
          ok: true,
          path: "<qml>",
          issueCount: 1,
          messages: [{
            ruleId: "qmllint.missing",
            severity: "warning",
            line: 1,
            column: 1,
            message: "qmllint not available. Install Qt qmllint for semantic QML linting."
          }]
        };
      }
      const messages = parseQmlLintDiagnostics(stderr);
      return { ok: true, path: "<qml>", issueCount: messages.length, messages };
    }
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function lintSynopterText(content) {
  const text = String(content || "");
  const messages = lintStructuredText(text, {
    hashComment: true,
    slashComment: true,
    blockComment: true
  });

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || "";
    if (/\t/.test(line)) {
      messages.push({
        ruleId: "style.tab",
        severity: "warning",
        line: i + 1,
        column: line.indexOf("\t") + 1,
        message: "Tab indentation detected; spaces are recommended for Synopter consistency"
      });
    }
  }

  return { ok: true, path: "<synopter>", issueCount: messages.length, messages };
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeMessages(body) {
  const rawMessages = Array.isArray(body?.messages)
    ? body.messages
    : [{ role: "user", content: body?.message }];

  const messages = [];
  let totalChars = 0;

  for (const item of rawMessages) {
    const role = item?.role;
    const content = typeof item?.content === "string" ? item.content.trim() : "";

    if ((role !== "user" && role !== "assistant") || !content) {
      continue;
    }

    totalChars += content.length;
    if (content.length > 8000 || totalChars > 32000) {
      return null;
    }

    messages.push({ role, content });
  }

  if (messages.length === 0) {
    return null;
  }

  return messages;
}

async function getFileList(pathValue) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const entries = await fsp.readdir(absolute, { withFileTypes: true });
  const mapped = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(absolute, entry.name);
    const stat = await fsp.stat(entryPath);
    return {
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  }));
  mapped.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return { path: rel, entries: mapped };
}

async function readTextFile(pathValue) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const stat = await fsp.stat(absolute);
  if (stat.isDirectory()) {
    throw new Error("path is a directory");
  }
  if (stat.size > maxReadBytes) {
    throw new Error(`file exceeds max read size (${maxReadBytes} bytes)`);
  }
  const content = await fsp.readFile(absolute, "utf8");
  return { path: rel, size: stat.size, content };
}

async function writeTextFile(pathValue, content) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const text = typeof content === "string" ? content : "";
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, text, "utf8");
  await commitSandboxSnapshot(`write ${rel || "."}`);
  return { ok: true, path: rel };
}

async function formatTextFile(pathValue, content) {
  const targetPath = String(pathValue || "");
  const ext = path.extname(targetPath).toLowerCase();
  if (ext === ".py") {
    return formatPythonText(content);
  }
  if (isCExt(ext) || isCppExt(ext)) {
    return formatCCppText(content, ext);
  }
  if (isTclExt(ext)) {
    return formatTclText(content);
  }

  const parser = detectPrettierParser(targetPath);
  if (!parser) {
    throw new Error("Unsupported file extension for formatter");
  }
  const text = typeof content === "string" ? content : "";
  const formatted = await prettier.format(text, { parser });
  return { ok: true, parser, formatted };
}

async function lintTextFile(pathValue, content) {
  const targetPath = String(pathValue || "").trim();
  if (!targetPath) {
    throw new Error("path is required");
  }

  const ext = path.extname(targetPath).toLowerCase();
  if (ext === ".py") {
    return lintPythonText(content);
  }
  if (ext === ".json") {
    return lintJsonText(content);
  }
  if (isCExt(ext) || isCppExt(ext)) {
    return lintCCppText(content, ext);
  }
  if (isTclExt(ext)) {
    return lintTclText(content);
  }
  if (isQmlExt(ext)) {
    return lintQmlText(content);
  }
  if (isSynopterExt(ext)) {
    return lintSynopterText(content);
  }

  if (![".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"].includes(ext)) {
    throw new Error("lint supports JS/TS, Python, JSON, C/C++, Tcl, QML, and Synopter file extensions");
  }

  const eslintModule = await import("eslint");
  const ESLintCtor = eslintModule.ESLint;
  const isTypeScript = ext === ".ts" || ext === ".tsx";
  let parser;
  if (isTypeScript) {
    const tsParserModule = await import("@typescript-eslint/parser");
    parser = tsParserModule.default || tsParserModule;
  }

  const eslint = new ESLintCtor({
    overrideConfig: {
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ...(parser ? { parser } : {})
      },
      rules: {
        eqeqeq: "warn",
        "no-unused-vars": "warn",
        "no-undef": isTypeScript ? "off" : "warn"
      }
    },
    overrideConfigFile: true,
    ignore: false
  });

  const [result] = await eslint.lintText(String(content || ""), { filePath: targetPath });
  const messages = (result?.messages || []).map((msg) => ({
    ruleId: msg.ruleId || null,
    severity: msg.severity === 2 ? "error" : "warning",
    line: msg.line || 0,
    column: msg.column || 0,
    message: msg.message
  }));

  return { ok: true, path: targetPath, issueCount: messages.length, messages };
}

function renderMarkdownToHtml(markdownValue) {
  let text = String(markdownValue || "");
  text = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

  const fences = [];
  text = text.replace(/```([\s\S]*?)```/g, (_m, code) => {
    const token = `@@FENCE_${fences.length}@@`;
    fences.push(`<pre><code>${String(code || "").trim()}</code></pre>`);
    return token;
  });

  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || "");
  const splitTableCells = (line) => String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const tableAlignFromDivider = (cell) => {
    const value = String(cell || "").trim();
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    if (value.startsWith(":")) return "left";
    return "left";
  };

  const lines = text.split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const nextLine = lines[i + 1] || "";

    if (line.includes("|") && isTableDivider(nextLine)) {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }

      const headerCells = splitTableCells(line);
      const dividerCells = splitTableCells(nextLine);
      const alignments = dividerCells.map(tableAlignFromDivider);
      out.push("<table><thead><tr>");
      headerCells.forEach((cell, index) => {
        out.push(`<th style=\"text-align:${alignments[index] || "left"}\">${cell}</th>`);
      });
      out.push("</tr></thead><tbody>");
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i];
        if (!rowLine.trim() || !rowLine.includes("|")) {
          break;
        }
        const rowCells = splitTableCells(rowLine);
        out.push("<tr>");
        rowCells.forEach((cell, index) => {
          out.push(`<td style=\"text-align:${alignments[index] || "left"}\">${cell}</td>`);
        });
        out.push("</tr>");
        i += 1;
      }
      out.push("</tbody></table>");
      i -= 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inUl) {
        out.push("<ul>");
        inUl = true;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
      out.push(`<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      if (!inOl) {
        out.push("<ol>");
        inOl = true;
      }
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      out.push(`<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`);
      continue;
    }

    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }

    if (/^\s{0,3}([-*_])\s*\1\s*\1(?:\s*\1)*\s*$/.test(line)) {
      out.push("<hr />");
      continue;
    }

    if (line.trim()) {
      if (/^<h[1-3]>/.test(line) || /^@@FENCE_\d+@@$/.test(line.trim()) || /^<table/.test(line)) {
        out.push(line);
      } else {
        out.push(`<p>${line}</p>`);
      }
    }
  }

  if (inUl) {
    out.push("</ul>");
  }
  if (inOl) {
    out.push("</ol>");
  }

  let html = out.join("\n");
  fences.forEach((block, index) => {
    html = html.replace(`@@FENCE_${index}@@`, block);
  });
  return html;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function csvToJson(csvText) {
  const lines = String(csvText || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function jsonToCsv(value) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) {
    return "";
  }
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const escapeCell = (cell) => {
    const raw = String(cell ?? "");
    if (/[",\n]/.test(raw)) {
      return `"${raw.replaceAll('"', '""')}"`;
    }
    return raw;
  };
  const body = rows.map((row) => headers.map((header) => escapeCell(row?.[header])).join(","));
  return [headers.join(","), ...body].join("\n");
}

async function deleteSandboxPath(pathValue) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  if (!rel) {
    throw new Error("refusing to delete sandbox root");
  }
  await fsp.rm(absolute, { recursive: true, force: true });
  await commitSandboxSnapshot(`delete ${rel}`);
  return { ok: true, path: rel };
}

async function renameSandboxPath(fromPath, toPath) {
  const { absolute: fromAbs, rel: fromRel } = resolveSandboxPath(fromPath || "");
  const { absolute: toAbs, rel: toRel } = resolveSandboxPath(toPath || "");
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  await fsp.rename(fromAbs, toAbs);
  await commitSandboxSnapshot(`move ${fromRel} -> ${toRel}`);
  return { ok: true, fromPath: fromRel, toPath: toRel };
}

async function createSandboxDirectory(pathValue) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  await fsp.mkdir(absolute, { recursive: true });
  await commitSandboxSnapshot(`mkdir ${rel || "."}`);
  return { ok: true, path: rel };
}

async function zipSandboxPath(sourcePath, archivePath) {
  const { absolute: sourceAbs, rel: sourceRel } = resolveSandboxPath(sourcePath || "");
  const sourceStat = await fsp.stat(sourceAbs);
  const defaultArchive = `${path.basename(sourceRel || "workspace") || "workspace"}.zip`;
  const { absolute: archiveAbs, rel: archiveRel } = resolveSandboxPath(archivePath || defaultArchive);
  await fsp.mkdir(path.dirname(archiveAbs), { recursive: true });

  const cwd = sourceStat.isDirectory() ? sourceAbs : path.dirname(sourceAbs);
  const includeTarget = sourceStat.isDirectory() ? "." : path.basename(sourceAbs);
  try {
    await execFileAsync("zip", ["-r", "-q", archiveAbs, includeTarget], { cwd, timeout: 120000 });
  } catch (error) {
    throw new Error(`zip command failed. Ensure 'zip' is installed. ${String(error?.stderr || error?.message || "")}`.trim());
  }

  await commitSandboxSnapshot(`zip ${sourceRel || "."} -> ${archiveRel}`);
  return { ok: true, sourcePath: sourceRel, archivePath: archiveRel };
}

async function unzipSandboxArchive(archivePath, targetPath) {
  const { absolute: archiveAbs, rel: archiveRel } = resolveSandboxPath(archivePath || "");
  const defaultTarget = path.basename(archiveRel, ".zip");
  const { absolute: targetAbs, rel: targetRel } = resolveSandboxPath(targetPath || defaultTarget);
  await fsp.mkdir(targetAbs, { recursive: true });

  try {
    await execFileAsync("unzip", ["-o", archiveAbs, "-d", targetAbs], { cwd: getSandboxRoot(), timeout: 120000 });
  } catch (error) {
    throw new Error(`unzip command failed. Ensure 'unzip' is installed. ${String(error?.stderr || error?.message || "")}`.trim());
  }

  await commitSandboxSnapshot(`unzip ${archiveRel} -> ${targetRel}`);
  return { ok: true, archivePath: archiveRel, targetPath: targetRel };
}

function getAllowedTerminalCommands() {
  const allowed = new Set(safeTerminalCommands);
  for (const cmd of String(process.env.TERMINAL_EXTRA_COMMANDS || "")
    .split(",")
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean)) {
    allowed.add(cmd);
  }
  if (terminalRuntime === "docker") {
    for (const cmd of dockerOnlyTerminalCommands) {
      allowed.add(cmd);
    }
  }
  return allowed;
}

function pushTerminalToken(tokens, token) {
  if (token) {
    tokens.push(token);
  }
}

function tokenizeTerminalCommandLine(commandLine) {
  const source = String(commandLine || "").trim();
  const tokens = [];
  let token = "";
  let quote = "";
  let escaping = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || "";

    if (escaping) {
      token += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = "";
      } else {
        token += ch;
      }
      continue;
    }

    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      pushTerminalToken(tokens, token);
      token = "";
      continue;
    }

    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      pushTerminalToken(tokens, token);
      token = "";
      tokens.push(`${ch}${next}`);
      i += 1;
      continue;
    }

    if (ch === ";") {
      pushTerminalToken(tokens, token);
      token = "";
      tokens.push(";");
      continue;
    }

    token += ch;
  }

  if (escaping) {
    token += "\\";
  }

  if (quote) {
    throw new Error("command contains an unterminated quote");
  }

  pushTerminalToken(tokens, token);
  return tokens;
}

function cleanTerminalArgs(tokens) {
  return tokens.filter((token) => {
    const value = String(token || "").trim();
    return value && !shellLikeRedirectionTokens.has(value);
  });
}

function parseTerminalCommandSegments(commandName, args) {
  if (Array.isArray(args) && args.length > 0) {
    return [{
      operator: "start",
      command: String(commandName || "").trim(),
      args: args.map((item) => String(item))
    }];
  }

  const tokens = tokenizeTerminalCommandLine(commandName);
  if (tokens.length === 0) {
    throw new Error("command is required");
  }

  const segments = [];
  let pendingOperator = "start";
  let current = [];

  const pushSegment = () => {
    const clean = cleanTerminalArgs(current);
    if (clean.length === 0) {
      throw new Error("command contains an empty segment");
    }
    segments.push({
      operator: pendingOperator,
      command: clean[0],
      args: clean.slice(1)
    });
    current = [];
  };

  for (const token of tokens) {
    if (shellLikeConditionalOperators.has(token)) {
      pushSegment();
      pendingOperator = token;
      continue;
    }
    current.push(token);
  }

  pushSegment();
  return segments;
}

function isTerminalArgOutsideWorkspace(arg) {
  const value = String(arg || "").trim();
  if (!value || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    return false;
  }
  return blockedTerminalPathArgPatterns.some((pattern) => pattern.test(value));
}

function isAbsoluteOrHomeTerminalPath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value)
    || /^[/\\]/.test(value)
    || /^~(?:[/\\]|$)/.test(value);
}

async function resolveTerminalCwdPath(cwdPath, nextPath) {
  const currentRel = resolveSandboxPath(cwdPath || "").rel;
  const rawNext = String(nextPath || "").trim();
  if (!rawNext || rawNext === ".") {
    return currentRel;
  }
  if (isAbsoluteOrHomeTerminalPath(rawNext)) {
    throw new Error(`cd target '${rawNext}' points outside the workspace`);
  }
  const joined = path.posix.normalize(path.posix.join((currentRel || "").replaceAll("\\", "/"), rawNext.replaceAll("\\", "/")));
  const { absolute, rel } = resolveSandboxPath(joined);
  const stat = await fsp.stat(absolute);
  if (!stat.isDirectory()) {
    throw new Error(`cd target '${rawNext}' is not a directory`);
  }
  return rel === "." ? "" : rel;
}

function looksLikePath(value) {
  return value.includes("/") || value.includes("\\") || value.startsWith(".");
}

function resolveProjectRelativeExecutable(value) {
  if (!looksLikePath(value)) {
    return value;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(projectRoot, value);
}

function resolveTerminalInvocation(commandName, args) {
  const commandArgs = Array.isArray(args) ? args.map((item) => String(item)) : [];
  if (commandName !== "vfa") {
    return {
      command: commandName,
      args: commandArgs,
      preferHostRuntime: terminalHostFallbackCommands.has(commandName),
      resolvedBy: "allowlist"
    };
  }

  if (terminalVfaCommand) {
    return {
      command: resolveProjectRelativeExecutable(terminalVfaCommand),
      args: commandArgs,
      preferHostRuntime: true,
      resolvedBy: "TERMINAL_VFA_COMMAND"
    };
  }

  const vfaScriptPath = resolveProjectRelativeExecutable(terminalVfaScript);
  if (fs.existsSync(vfaScriptPath)) {
    return {
      command: "python3",
      args: [vfaScriptPath, ...commandArgs],
      preferHostRuntime: true,
      resolvedBy: "TERMINAL_VFA_SCRIPT"
    };
  }

  throw new Error("command 'vfa' is not available; set TERMINAL_VFA_COMMAND or TERMINAL_VFA_SCRIPT");
}

function getTerminalIsolationDirs(sandboxRoot) {
  const homeDir = path.join(sandboxRoot, ".home");
  const cacheDir = path.join(sandboxRoot, ".cache");
  const npmPrefixDir = path.join(sandboxRoot, ".npm-global");
  const pythonPackagesDir = path.join(sandboxRoot, ".python-packages");
  const pythonScriptsDir = path.join(pythonPackagesDir, "bin");
  const npmBinDir = path.join(npmPrefixDir, "bin");
  return {
    homeDir,
    cacheDir,
    npmPrefixDir,
    pythonPackagesDir,
    pythonScriptsDir,
    npmBinDir
  };
}

async function runWorkspaceCommandInDocker(commandName, commandArgs, cwdRel, timeout, sandboxRoot, envVars) {
  const inContainerCwd = cwdRel ? `/workspace/${cwdRel}` : "/workspace";
  const dockerArgs = [
    "run",
    "--rm",
    "--network", terminalDockerNetwork,
    "--memory", terminalDockerMemory,
    "--cpus", terminalDockerCpus,
    "--pids-limit", String(terminalDockerPidsLimit),
    "--security-opt", "no-new-privileges",
    "-v", `${sandboxRoot}:/workspace`,
    "-w", inContainerCwd
  ];

  for (const [key, value] of Object.entries(envVars)) {
    dockerArgs.push("-e", `${key}=${value}`);
  }

  dockerArgs.push(terminalDockerImage, commandName, ...commandArgs);
  return execFileAsync("docker", dockerArgs, { timeout });
}

async function runSingleSafeTerminalCommand(commandName, args, cwdPath, timeoutMs) {
  const name = String(commandName || "").trim().toLowerCase();
  if (blockedTerminalCommandsAlways.has(name)) {
    throw new Error(`command '${name}' is blocked on this server`);
  }

  if (terminalRuntime === "host" && blockedTerminalCommandsHostOnly.has(name)) {
    throw new Error(`command '${name}' is blocked in host terminal runtime`);
  }

  const allowedTerminalCommands = getAllowedTerminalCommands();
  if (!allowedTerminalCommands.has(name)) {
    throw new Error(`command '${name}' is not allowed`);
  }

  if (name === "cd") {
    if (args.length > 1) {
      throw new Error("cd accepts at most one target path");
    }
    const cwdRel = await resolveTerminalCwdPath(cwdPath || "", args[0] || "");
    return {
      ok: true,
      command: name,
      executable: "virtual-cd",
      resolvedBy: "virtual-command",
      args,
      cwd: cwdRel,
      runtime: "virtual",
      stdout: "",
      stderr: ""
    };
  }

  const invocation = resolveTerminalInvocation(name, args);
  const commandArgs = invocation.args;
  const commandToExecute = invocation.command;
  const effectiveRuntime = terminalRuntime === "docker" && !invocation.preferHostRuntime ? "docker" : "host";

  if (effectiveRuntime === "host" && blockedTerminalCommandsHostOnly.has(name)) {
    throw new Error(`command '${name}' is blocked in host terminal runtime`);
  }

  for (const arg of commandArgs) {
    if (blockedTerminalArgPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error(`argument '${arg}' is not allowed`);
    }
    if (isTerminalArgOutsideWorkspace(arg)) {
      throw new Error(`argument '${arg}' points outside the workspace`);
    }
  }

  if (name === "npm" && commandArgs.some((arg) => arg === "-g" || arg === "--global")) {
    throw new Error("npm global installs are blocked; use workspace-local installs only");
  }

  if ((name === "pip" || name === "pip3") && commandArgs.some((arg) => /^--(prefix|root|target)=?/i.test(arg))) {
    throw new Error("pip path overrides are blocked");
  }

  if ((name === "python" || name === "python3")
    && commandArgs.length >= 2
    && commandArgs[0] === "-m"
    && commandArgs[1] === "pip"
    && commandArgs.some((arg) => /^--(prefix|root|target)=?/i.test(arg))) {
    throw new Error("python -m pip path overrides are blocked");
  }

  const maxTimeout = effectiveRuntime === "docker" ? 300000 : 60000;
  const defaultTimeout = effectiveRuntime === "docker" ? 45000 : 15000;
  const timeout = Math.max(1000, Math.min(maxTimeout, Number(timeoutMs || defaultTimeout)));
  const { absolute: cwdAbs, rel: cwdRel } = resolveSandboxPath(cwdPath || "");
  const sandboxRoot = getSandboxRoot();

  const {
    homeDir,
    cacheDir,
    npmPrefixDir,
    pythonPackagesDir,
    pythonScriptsDir,
    npmBinDir
  } = getTerminalIsolationDirs(sandboxRoot);

  await fsp.mkdir(homeDir, { recursive: true });
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.mkdir(npmPrefixDir, { recursive: true });
  await fsp.mkdir(pythonPackagesDir, { recursive: true });
  await fsp.mkdir(pythonScriptsDir, { recursive: true });

  const basePath = String(process.env.PATH || "");
  const toolPath = [pythonScriptsDir, npmBinDir, basePath].filter(Boolean).join(path.delimiter);
  const hostExecEnv = {
    ...process.env,
    PATH: toolPath,
    HOME: homeDir,
    TMPDIR: cacheDir,
    TEMP: cacheDir,
    TMP: cacheDir,
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_CACHE_DIR: path.join(cacheDir, "pip"),
    PIP_TARGET: pythonPackagesDir,
    PYTHONPATH: pythonPackagesDir,
    npm_config_prefix: npmPrefixDir,
    npm_config_cache: path.join(cacheDir, "npm")
  };

  const containerExecEnv = {
    PATH: "/workspace/.python-packages/bin:/workspace/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/workspace/.home",
    TMPDIR: "/workspace/.cache",
    TEMP: "/workspace/.cache",
    TMP: "/workspace/.cache",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_CACHE_DIR: "/workspace/.cache/pip",
    PIP_TARGET: "/workspace/.python-packages",
    PYTHONPATH: "/workspace/.python-packages",
    npm_config_prefix: "/workspace/.npm-global",
    npm_config_cache: "/workspace/.cache/npm"
  };

  try {
    const result = effectiveRuntime === "docker"
      ? await runWorkspaceCommandInDocker(commandToExecute, commandArgs, cwdRel, timeout, sandboxRoot, containerExecEnv)
      : await execFileAsync(commandToExecute, commandArgs, { cwd: cwdAbs, timeout, env: hostExecEnv });
    return {
      ok: true,
      command: name,
      executable: commandToExecute,
      resolvedBy: invocation.resolvedBy,
      args: commandArgs,
      cwd: cwdRel,
      runtime: effectiveRuntime,
      stdout: String(result.stdout || "").slice(0, 12000),
      stderr: String(result.stderr || "").slice(0, 12000)
    };
  } catch (error) {
    return {
      ok: false,
      command: name,
      executable: commandToExecute,
      resolvedBy: invocation.resolvedBy,
      args: commandArgs,
      cwd: cwdRel,
      runtime: effectiveRuntime,
      code: Number(error?.code || 1),
      stdout: String(error?.stdout || "").slice(0, 12000),
      stderr: String(error?.stderr || error?.message || "").slice(0, 12000)
    };
  }
}

function shouldRunTerminalSegment(operator, previousResult) {
  if (!previousResult || operator === "start" || operator === ";") {
    return true;
  }
  if (operator === "&&") {
    return Boolean(previousResult.ok);
  }
  if (operator === "||") {
    return !previousResult.ok;
  }
  return false;
}

function summarizeTerminalSegment(result) {
  return {
    command: result.command,
    executable: result.executable,
    resolvedBy: result.resolvedBy,
    args: result.args,
    cwd: result.cwd,
    runtime: result.runtime,
    ok: result.ok,
    code: result.code || 0,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function runSafeTerminalCommand(commandName, args, cwdPath, timeoutMs) {
  const segments = parseTerminalCommandSegments(commandName, args);

  if (segments.length === 1) {
    return runSingleSafeTerminalCommand(segments[0].command, segments[0].args, cwdPath, timeoutMs);
  }

  const results = [];
  let previousResult = null;
  let currentCwd = resolveSandboxPath(cwdPath || "").rel;

  for (const segment of segments) {
    if (!shouldRunTerminalSegment(segment.operator, previousResult)) {
      results.push({
        operator: segment.operator,
        command: String(segment.command || "").trim().toLowerCase(),
        args: segment.args,
        skipped: true
      });
      continue;
    }

    const result = await runSingleSafeTerminalCommand(segment.command, segment.args, currentCwd, timeoutMs);
    previousResult = result;
    if (result.ok && typeof result.cwd === "string") {
      currentCwd = result.cwd;
    }
    results.push({
      operator: segment.operator,
      ...summarizeTerminalSegment(result)
    });
  }

  const executedResults = results.filter((result) => !result.skipped);
  const finalResult = executedResults[executedResults.length - 1] || { ok: true, code: 0, cwd: "" };
  const stdout = executedResults.map((result) => result.stdout || "").filter(Boolean).join("");
  const stderr = executedResults.map((result) => result.stderr || "").filter(Boolean).join("");

  return {
    ok: Boolean(finalResult.ok),
    command: String(commandName || "").trim(),
    executable: "command-line",
    resolvedBy: "parsed-command-line",
    args: [],
    cwd: finalResult.cwd || "",
    runtime: "mixed",
    code: finalResult.code || 0,
    stdout: stdout.slice(0, 12000),
    stderr: stderr.slice(0, 12000),
    commands: results
  };
}

async function runGitOperation(action, params) {
  const op = String(action || "").trim();
  switch (op) {
    case "status": {
      const result = await runGit(["status", "--short", "--branch"], true);
      return { ok: !result.code, action: op, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "log": {
      const limit = Math.max(1, Math.min(100, Number(params?.limit || 20)));
      const result = await runGit(["log", `-n${limit}`, "--pretty=format:%H%x09%h%x09%ad%x09%s", "--date=iso"], true);
      return { ok: !result.code, action: op, output: result.stdout || "", limit };
    }
    case "diff": {
      const target = String(params?.path || "").trim();
      const args = ["diff"];
      if (target) {
        const { rel } = resolveSandboxPath(target);
        args.push("--", rel);
      }
      const result = await runGit(args, true);
      return { ok: !result.code, action: op, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "add": {
      const files = Array.isArray(params?.paths) ? params.paths : [params?.path || "."];
      const safeFiles = files.map((item) => resolveSandboxPath(String(item || ".")).rel || ".");
      await runGit(["add", ...safeFiles]);
      return { ok: true, action: op, paths: safeFiles };
    }
    case "commit": {
      const message = String(params?.message || "").trim();
      if (!message) {
        throw new Error("message is required for git commit");
      }
      const result = await runGit(["commit", "-m", message], true);
      return { ok: !result.code, action: op, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "remote_info": {
      const info = await ensureWorkspaceGitRemoteSetup();
      return { ok: true, action: op, ...info };
    }
    case "pull": {
      const info = await ensureWorkspaceGitRemoteSetup();
      const result = await pullWorkspaceFromRemote({
        remoteName: params?.remoteName || info.remoteName,
        branch: params?.branch,
        strategy: params?.strategy
      });
      return { action: op, ...result, remotePath: info.remotePath, remoteSshUrl: info.remoteSshUrl };
    }
    case "push": {
      const info = await ensureWorkspaceGitRemoteSetup();
      const result = await pushWorkspaceToRemote({
        remoteName: params?.remoteName || info.remoteName,
        branch: params?.branch,
        setUpstream: params?.setUpstream,
        forceWithLease: params?.forceWithLease
      });
      return { action: op, ...result, remotePath: info.remotePath, remoteSshUrl: info.remoteSshUrl };
    }
    default:
      throw new Error("Unsupported git action. Use status, log, diff, add, commit, remote_info, pull, or push.");
  }
}

async function listGitSnapshots(limit = 30) {
  const bounded = Math.max(1, Math.min(200, Number(limit || 30)));
  const { stdout } = await runGit([
    "log",
    `-n${bounded}`,
    "--pretty=format:%H%x09%h%x09%ad%x09%s",
    "--date=iso"
  ], true);

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, date, ...subjectParts] = line.split("\t");
      return {
        hash,
        shortHash,
        date,
        subject: subjectParts.join("\t")
      };
    });
}

async function createManualSnapshot(message) {
  const msg = String(message || "").trim() || `manual snapshot ${new Date().toISOString()}`;
  await commitSandboxSnapshot(msg);
  const snapshots = await listGitSnapshots(1);
  return snapshots[0] || null;
}

async function restoreSnapshot(ref) {
  const target = String(ref || "").trim() || "HEAD~1";
  await runGit(["reset", "--hard", target]);
  await runGit(["clean", "-fd"]);
  await commitSandboxSnapshot(`revert baseline ${target}`);
  return { ok: true, ref: target };
}

async function getGitDiffBetweenRefs(leftRef, rightRef, targetPath) {
  const left = String(leftRef || "HEAD~1").trim() || "HEAD~1";
  const right = String(rightRef || "HEAD").trim() || "HEAD";
  const args = ["diff", "--no-color", left, right];
  if (targetPath && String(targetPath).trim()) {
    const { rel } = resolveSandboxPath(String(targetPath));
    args.push("--", rel);
  }
  const result = await runGit(args, true);
  return {
    ok: true,
    left,
    right,
    path: targetPath ? resolveSandboxPath(String(targetPath)).rel : "",
    diff: `${result.stdout || ""}${result.stderr || ""}`.trim()
  };
}

async function getPathDiffNoIndex(leftPath, rightPath) {
  const { absolute: leftAbs, rel: leftRel } = resolveSandboxPath(leftPath || "");
  const { absolute: rightAbs, rel: rightRel } = resolveSandboxPath(rightPath || "");
  try {
    const result = await execFileAsync("git", ["diff", "--no-color", "--no-index", leftAbs, rightAbs], {
      cwd: getSandboxRoot(),
      timeout: 120000
    });
    return { ok: true, leftPath: leftRel, rightPath: rightRel, diff: String(result.stdout || "") };
  } catch (error) {
    const code = Number(error?.code || 1);
    if (code === 1) {
      return {
        ok: true,
        leftPath: leftRel,
        rightPath: rightRel,
        diff: `${String(error?.stdout || "")}${String(error?.stderr || "")}`.trim()
      };
    }
    throw new Error(`path diff failed: ${String(error?.stderr || error?.message || "unknown error")}`);
  }
}

async function mergePathFromSnapshot(ref, targetPath) {
  const sourceRef = String(ref || "").trim();
  if (!sourceRef) {
    throw new Error("ref is required");
  }
  const { rel } = resolveSandboxPath(targetPath || "");
  if (!rel) {
    throw new Error("path is required");
  }
  await runGit(["checkout", sourceRef, "--", rel]);
  await commitSandboxSnapshot(`merge ${rel} from ${sourceRef}`);
  return { ok: true, ref: sourceRef, path: rel };
}

function tokenizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function extractSearchSnippet(content, queryLower) {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const idx = lower.indexOf(queryLower);
  if (idx >= 0) {
    const start = Math.max(0, idx - 80);
    const end = Math.min(text.length, idx + queryLower.length + 140);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
  }
  return text.slice(0, 220).replace(/\s+/g, " ").trim();
}

async function searchSandboxContent(args = {}) {
  const query = String(args.query || "").trim();
  if (!query) {
    throw new Error("query is required");
  }

  const modeRaw = String(args.mode || "hybrid").trim().toLowerCase();
  const mode = modeRaw === "full" || modeRaw === "semantic" || modeRaw === "hybrid" ? modeRaw : "hybrid";
  const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
  const maxFiles = Math.max(1, Math.min(800, Number(args.maxFiles || 300)));
  const maxFileBytes = Math.max(2048, Math.min(1024 * 1024, Number(args.maxFileBytes || 300000)));
  const { absolute: baseAbs, rel: baseRel } = resolveSandboxPath(args.path || "");
  const stat = await fsp.stat(baseAbs);
  const targets = stat.isDirectory() ? await collectFilesRecursive(baseAbs, maxFiles) : [baseAbs];

  const queryLower = query.toLowerCase();
  const queryTokens = new Set(tokenizeSearchText(query));
  const results = [];

  for (const filePath of targets) {
    let fileStat;
    try {
      fileStat = await fsp.stat(filePath);
    } catch {
      continue;
    }
    if (!fileStat.isFile() || fileStat.size > maxFileBytes) {
      continue;
    }

    let content;
    try {
      content = await fsp.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    if (content.includes("\0")) {
      continue;
    }

    const lower = content.toLowerCase();
    const exactCount = lower.split(queryLower).length - 1;

    const fileTokens = new Set(tokenizeSearchText(content.slice(0, 12000)));
    let overlap = 0;
    for (const token of queryTokens) {
      if (fileTokens.has(token)) {
        overlap += 1;
      }
    }
    const semanticScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;

    let score = 0;
    if (mode === "full") {
      score = exactCount;
    } else if (mode === "semantic") {
      score = semanticScore;
    } else {
      score = exactCount * 1.25 + semanticScore;
    }

    if (score <= 0) {
      continue;
    }

    results.push({
      path: path.relative(getSandboxRoot(), filePath).replaceAll("\\", "/"),
      score: Number(score.toFixed(4)),
      exactCount,
      semanticScore: Number(semanticScore.toFixed(4)),
      snippet: extractSearchSnippet(content, queryLower),
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString()
    });
  }

  results.sort((a, b) => b.score - a.score || b.exactCount - a.exactCount || a.path.localeCompare(b.path));

  return {
    ok: true,
    query,
    mode,
    path: baseRel,
    filesScanned: targets.length,
    resultCount: results.length,
    results: results.slice(0, limit)
  };
}

async function runAutomatedTestProfile(args = {}) {
  const profile = String(args.profile || "npm-test").trim().toLowerCase();
  const timeoutMs = Math.max(2000, Math.min(10 * 60 * 1000, Number(args.timeoutMs || 120000)));
  const cwdScope = String(args.cwd || "project").trim().toLowerCase();
  const cwd = cwdScope === "sandbox" ? getSandboxRoot() : projectRoot;

  let command = "npm";
  let commandArgs = ["test"];
  if (profile === "node-test") {
    command = "node";
    commandArgs = ["--test"];
  } else if (profile === "chat-jobs-smoke") {
    command = "node";
    commandArgs = ["--test", "tests/chat-jobs.test.mjs"];
  } else if (profile === "npm-lint") {
    command = "npm";
    commandArgs = ["run", "lint"];
  } else if (profile === "npm-test") {
    command = "npm";
    commandArgs = ["test"];
  } else {
    throw new Error("Unsupported profile. Use npm-test, npm-lint, node-test, or chat-jobs-smoke.");
  }

  try {
    const result = await execFileAsync(command, commandArgs, { cwd, timeout: timeoutMs });
    const stdout = String(result.stdout || "").slice(0, 50000);
    const stderr = String(result.stderr || "").slice(0, 50000);
    return {
      ok: true,
      profile,
      cwd: cwdScope,
      command,
      args: commandArgs,
      exitCode: 0,
      stdout,
      stderr,
      failures: []
    };
  } catch (error) {
    const stdout = String(error?.stdout || "").slice(0, 50000);
    const stderr = String(error?.stderr || error?.message || "").slice(0, 50000);
    const combined = `${stdout}\n${stderr}`;
    const failures = combined
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && /\b(fail|failed|error|not ok|✖)\b/i.test(line))
      .slice(0, 120);

    return {
      ok: false,
      profile,
      cwd: cwdScope,
      command,
      args: commandArgs,
      exitCode: Number(error?.code || 1),
      stdout,
      stderr,
      failures
    };
  }
}

async function processImageFile(args = {}) {
  let sharp;
  try {
    const sharpModule = await import("sharp");
    sharp = sharpModule.default || sharpModule;
  } catch {
    throw new Error("Image processing requires 'sharp'. Install it with npm install sharp.");
  }

  const inputPath = String(args.path || "").trim();
  if (!inputPath) {
    throw new Error("path is required");
  }
  const action = String(args.action || "resize").trim();
  const { absolute: inputAbs, rel: inputRel } = resolveSandboxPath(inputPath);
  const outputDefault = `${inputRel}.out`;
  const { absolute: outputAbs, rel: outputRel } = resolveSandboxPath(args.outputPath || outputDefault);

  await fsp.mkdir(path.dirname(outputAbs), { recursive: true });
  let image = sharp(inputAbs);

  if (action === "resize") {
    const width = Number(args.width || 0) || undefined;
    const height = Number(args.height || 0) || undefined;
    image = image.resize({ width, height, fit: "inside", withoutEnlargement: true });
  }

  const format = String(args.format || "").trim().toLowerCase();
  const quality = Math.max(1, Math.min(100, Number(args.quality || 80)));
  if (format === "png") image = image.png();
  if (format === "jpeg" || format === "jpg") image = image.jpeg({ quality });
  if (format === "webp") image = image.webp({ quality });
  if (format === "avif") image = image.avif({ quality });

  await image.toFile(outputAbs);
  await commitSandboxSnapshot(`process image ${inputRel} -> ${outputRel}`);
  const metadata = await sharp(outputAbs).metadata();
  return { ok: true, inputPath: inputRel, outputPath: outputRel, metadata };
}

async function collectFilesRecursive(rootAbs, limit = 500) {
  const files = [];
  const stack = [rootAbs];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        files.push(fullPath);
        if (files.length >= limit) {
          return files;
        }
      }
    }
  }
  return files;
}

async function searchReplaceInFiles(args = {}) {
  const basePath = String(args.path || "").trim();
  const query = String(args.query || "");
  const replacement = String(args.replacement || "");
  const useRegex = Boolean(args.regex);
  const caseSensitive = Boolean(args.caseSensitive);
  const maxFiles = Math.max(1, Math.min(1000, Number(args.maxFiles || 250)));
  if (!query) {
    throw new Error("query is required");
  }

  const { absolute: baseAbs, rel: baseRel } = resolveSandboxPath(basePath);
  const stat = await fsp.stat(baseAbs);
  const targets = stat.isDirectory() ? await collectFilesRecursive(baseAbs, maxFiles) : [baseAbs];
  const changedFiles = [];
  let replacementCount = 0;

  const flags = `g${caseSensitive ? "" : "i"}`;
  const regex = useRegex ? new RegExp(query, flags) : null;

  for (const filePath of targets) {
    let original;
    try {
      original = await fsp.readFile(filePath, "utf8");
    } catch {
      continue;
    }
    if (original.includes("\0")) {
      continue;
    }

    let updated = original;
    let count = 0;
    if (useRegex) {
      const matches = original.match(regex);
      count = matches ? matches.length : 0;
      if (count > 0) {
        updated = original.replace(regex, replacement);
      }
    } else {
      const source = caseSensitive ? original : original.toLowerCase();
      const needle = caseSensitive ? query : query.toLowerCase();
      count = source.split(needle).length - 1;
      if (count > 0) {
        const replaceRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        updated = original.replace(replaceRegex, replacement);
      }
    }

    if (count > 0 && updated !== original) {
      await fsp.writeFile(filePath, updated, "utf8");
      replacementCount += count;
      changedFiles.push(path.relative(getSandboxRoot(), filePath).replaceAll("\\", "/"));
    }
  }

  if (changedFiles.length > 0) {
    await commitSandboxSnapshot(`search_replace ${baseRel || "."} (${replacementCount})`);
  }

  return {
    ok: true,
    path: baseRel,
    filesScanned: targets.length,
    filesChanged: changedFiles.length,
    replacementCount,
    changedFiles: changedFiles.slice(0, 100)
  };
}

async function exportImportWorkspace(args = {}) {
  const action = String(args.action || "export").trim();
  if (action === "export") {
    return zipSandboxPath(String(args.path || ""), String(args.archivePath || "workspace-export.zip"));
  }
  if (action === "import") {
    const archivePath = String(args.archivePath || "").trim();
    if (!archivePath) {
      throw new Error("archivePath is required for import");
    }
    return unzipSandboxArchive(archivePath, String(args.targetPath || ""));
  }
  throw new Error("action must be export or import");
}

async function testApiEndpoint(args = {}) {
  const url = String(args.url || "").trim();
  if (!isHttpUrl(url)) {
    throw new Error("url must start with http:// or https://");
  }
  const method = String(args.method || "GET").trim().toUpperCase();
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
  if (!allowedMethods.has(method)) {
    throw new Error("unsupported method");
  }

  const timeout = Math.max(1000, Math.min(30000, Number(args.timeoutMs || 8000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const headers = {};
    if (args.headers && typeof args.headers === "object") {
      for (const [key, value] of Object.entries(args.headers)) {
        headers[String(key)] = String(value);
      }
    }
    let body;
    if (args.body != null) {
      body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const text = await response.text();
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyText: text.slice(0, 20000)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callInternalApiFromAgent(args = {}) {
  const rawPath = String(args.path || "").trim();
  if (!rawPath || !rawPath.startsWith("/api/")) {
    throw new Error("path must start with /api/");
  }
  if (rawPath.startsWith("/api/admin/")) {
    throw new Error("/api/admin endpoints are not available to agent tools");
  }

  const method = String(args.method || "GET").trim().toUpperCase();
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
  if (!allowedMethods.has(method)) {
    throw new Error("unsupported method");
  }

  const timeoutMs = Math.max(1000, Math.min(30000, Number(args.timeoutMs || 8000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(rawPath, appBaseUrl);
    const query = args?.query;
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value == null) {
          continue;
        }
        url.searchParams.set(String(key), String(value));
      }
    }

    const headers = {};
    if (args.headers && typeof args.headers === "object") {
      for (const [key, value] of Object.entries(args.headers)) {
        headers[String(key)] = String(value);
      }
    }

    const workspaceCode = getWorkspaceContext().code;
    if (workspaceCode && !headers["x-workspace-code"] && !headers["X-Workspace-Code"]) {
      headers["x-workspace-code"] = workspaceCode;
    }

    const security = getEffectiveSecuritySettingsSync();
    if (security.apiKeyAuthEnabled && security.apiKeys.length > 0) {
      const hasApiHeader = Object.keys(headers).some((key) => key.toLowerCase() === security.apiKeyHeaderName);
      if (!hasApiHeader) {
        headers[security.apiKeyHeaderName] = security.apiKeys[0];
      }
    }

    let body;
    if (args.body != null) {
      body = typeof args.body === "string" ? args.body : JSON.stringify(args.body);
      const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
      if (!hasContentType) {
        headers["Content-Type"] = "application/json";
      }
    }

    const response = await fetch(url.toString(), { method, headers, body, signal: controller.signal });
    const text = await response.text();
    let bodyJson = null;
    try {
      bodyJson = text ? JSON.parse(text) : null;
    } catch {
      bodyJson = null;
    }

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: responseHeaders,
      bodyJson,
      bodyText: text.slice(0, 20000)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function chmodRecursive(absPath, mode) {
  const stat = await fsp.stat(absPath);
  await fsp.chmod(absPath, mode);
  if (stat.isDirectory()) {
    const entries = await fsp.readdir(absPath, { withFileTypes: true });
    for (const entry of entries) {
      await chmodRecursive(path.join(absPath, entry.name), mode);
    }
  }
}

async function manageSandboxPermissions(args = {}) {
  const targetPath = String(args.path || "").trim();
  if (!targetPath) {
    throw new Error("path is required");
  }
  const modeText = String(args.mode || "").trim();
  if (!/^[0-7]{3,4}$/.test(modeText)) {
    throw new Error("mode must be octal like 644 or 755");
  }
  const mode = Number.parseInt(modeText, 8);
  const recursive = Boolean(args.recursive);
  const { absolute, rel } = resolveSandboxPath(targetPath);
  if (recursive) {
    await chmodRecursive(absolute, mode);
  } else {
    await fsp.chmod(absolute, mode);
  }
  await commitSandboxSnapshot(`chmod ${modeText} ${rel}`);
  return { ok: true, path: rel, mode: modeText, recursive };
}

function listScheduledTasks() {
  return [...scheduledTasks.values()].map((task) => ({
    id: task.id,
    tool: task.tool,
    runAt: task.runAt,
    createdAt: task.createdAt,
    status: task.status
  }));
}

async function createNotification(req, message, level = "info") {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level: String(level || "info").slice(0, 16),
    message: String(message || "").slice(0, 1000)
  };
  notificationStore.unshift(entry);
  if (notificationStore.length > 200) {
    notificationStore.length = 200;
  }
  await appendAuditLog(req, "notify", { level: entry.level, message: entry.message });
  return entry;
}

async function searchStackOverflow(query, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), agentWebTimeoutMs);
  try {
    const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", "relevance");
    url.searchParams.set("site", "stackoverflow");
    url.searchParams.set("filter", "!nNPvSNVxV8");
    url.searchParams.set("q", query);
    url.searchParams.set("pagesize", String(limit));

    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    const items = (data?.items || []).map((item) => ({
      title: stripHtml(item.title),
      url: item.link,
      score: item.score,
      answerCount: item.answer_count,
      isAnswered: item.is_answered
    }));
    if (items.length > 0) {
      return items.slice(0, limit);
    }

    const htmlResponse = await fetch(`https://stackoverflow.com/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "remote-ai-access/1.0"
      }
    });
    if (!htmlResponse.ok) {
      return [];
    }
    const html = await htmlResponse.text();
    const matches = [...html.matchAll(/href="\/(questions\/\d+\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
    const dedupe = new Set();
    const fallback = [];
    for (const match of matches) {
      const relPath = match[1];
      const urlValue = `https://stackoverflow.com/${relPath}`;
      if (dedupe.has(urlValue)) {
        continue;
      }
      dedupe.add(urlValue);
      fallback.push({
        title: stripHtml(match[2]),
        url: urlValue,
        score: null,
        answerCount: null,
        isAnswered: null
      });
      if (fallback.length >= limit) {
        break;
      }
    }
    return fallback;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchDuckDuckGo(query, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), agentWebTimeoutMs);
  try {
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");

    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();

    const topics = [];
    const stack = Array.isArray(data?.RelatedTopics) ? [...data.RelatedTopics] : [];
    while (stack.length > 0 && topics.length < limit) {
      const item = stack.shift();
      if (!item) {
        continue;
      }
      if (Array.isArray(item.Topics)) {
        stack.push(...item.Topics);
        continue;
      }
      if (item.FirstURL || item.Text) {
        topics.push({
          title: String(item.Text || "").slice(0, 240),
          url: item.FirstURL || ""
        });
      }
    }
    return topics;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const agentToolDefinitions = [
  {
    type: "function",
    function: {
      name: "list_tools",
      description: "List all available agent tool names and descriptions.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_apis",
      description: "List available HTTP API endpoints and purposes.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "tool_status",
      description: "Check whether tools have run recently, when they last ran, and recent execution history.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional specific tool name to inspect" },
          limit: { type: "number", description: "How many recent runs to inspect, default 10" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and folders in a sandbox directory.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative sandbox path, like src or docs" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write text to a sandbox file and snapshot it in git.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "format_code",
      description: "Format code/text using Prettier and return formatted text.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lint_code",
      description: "Lint JS/TS code and return warnings/errors.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search Stack Overflow and general web snippets for technical info.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_webpage",
      description: "Fetch a web page and return simplified text content.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          maxChars: { type: "number" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file or folder inside sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rename_file",
      description: "Rename or move a file/folder inside sandbox.",
      parameters: {
        type: "object",
        properties: {
          fromPath: { type: "string" },
          toPath: { type: "string" }
        },
        required: ["fromPath", "toPath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_directory",
      description: "Create a new directory in sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "zip_unzip",
      description: "Create or extract zip archives inside sandbox.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "zip or unzip" },
          sourcePath: { type: "string", description: "path to file/folder for zip" },
          archivePath: { type: "string", description: "zip archive path" },
          targetPath: { type: "string", description: "extract destination for unzip" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_terminal",
      description: "Run safe allow-listed terminal commands. Accepts either command+args or a simple shell-like command line with quotes, &&, ||, and ;.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          timeoutMs: { type: "number" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_ops",
      description: "Run safe git operations in sandbox repo.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "status|log|diff|add|commit" },
          path: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
          message: { type: "string" },
          limit: { type: "number" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "preview_markdown",
      description: "Render markdown to HTML preview.",
      parameters: {
        type: "object",
        properties: {
          markdown: { type: "string" },
          path: { type: "string", description: "optional path to .md file" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "convert_format",
      description: "Convert between markdown/html/text/csv/json formats.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          content: { type: "string" }
        },
        required: ["from", "to", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "process_image",
      description: "Basic image transformation (resize/format) via sharp.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          outputPath: { type: "string" },
          action: { type: "string" },
          width: { type: "number" },
          height: { type: "number" },
          format: { type: "string" },
          quality: { type: "number" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_replace",
      description: "Run regex or literal search/replace across files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          query: { type: "string" },
          replacement: { type: "string" },
          regex: { type: "boolean" },
          caseSensitive: { type: "boolean" },
          maxFiles: { type: "number" }
        },
        required: ["path", "query", "replacement"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "export_import_workspace",
      description: "Export sandbox as zip or import zip into sandbox.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "export or import" },
          path: { type: "string" },
          archivePath: { type: "string" },
          targetPath: { type: "string" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "test_api",
      description: "Call arbitrary HTTP APIs and return status/headers/body.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          method: { type: "string" },
          headers: { type: "object" },
          body: { type: ["object", "string", "number", "boolean", "array", "null"] },
          timeoutMs: { type: "number" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "call_api",
      description: "Call this server's internal /api endpoints with workspace and API key headers when needed.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Internal API path like /api/files/list" },
          method: { type: "string" },
          query: { type: "object", description: "Optional query params object" },
          headers: { type: "object", description: "Optional extra request headers" },
          body: { type: ["object", "string", "number", "boolean", "array", "null"] },
          timeoutMs: { type: "number" }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_permissions",
      description: "Set file or directory mode (chmod) inside sandbox.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          mode: { type: "string", description: "octal mode like 644 or 755" },
          recursive: { type: "boolean" }
        },
        required: ["path", "mode"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_snapshots",
      description: "List, create, or restore sandbox git snapshots.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "list|create|restore" },
          limit: { type: "number", description: "used by list" },
          message: { type: "string", description: "used by create" },
          ref: { type: "string", description: "used by restore, e.g. HEAD~1 or commit hash" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "diff_merge",
      description: "Diff refs, diff two paths, or merge a file from snapshot into workspace.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "diff_refs|diff_paths|merge_from_snapshot" },
          left: { type: "string", description: "left git ref for diff_refs" },
          right: { type: "string", description: "right git ref for diff_refs" },
          path: { type: "string", description: "target path for diff_refs or merge_from_snapshot" },
          leftPath: { type: "string", description: "left path for diff_paths" },
          rightPath: { type: "string", description: "right path for diff_paths" },
          ref: { type: "string", description: "snapshot ref for merge_from_snapshot" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_workspace",
      description: "Search sandbox file contents using full-text, semantic, or hybrid scoring.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          mode: { type: "string", description: "full|semantic|hybrid" },
          path: { type: "string", description: "optional sandbox path scope" },
          limit: { type: "number" },
          maxFiles: { type: "number" },
          maxFileBytes: { type: "number" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description: "List test profiles or run an automated test profile.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "list_profiles|run" },
          profile: { type: "string", description: "npm-test|npm-lint|node-test" },
          cwd: { type: "string", description: "project|sandbox" },
          timeoutMs: { type: "number" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "schedule_task",
      description: "Schedule a tool call later, list scheduled tasks, or cancel by id.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "create|list|cancel" },
          id: { type: "string" },
          delayMs: { type: "number" },
          tool: { type: "string" },
          args: { type: "object" }
        },
        required: ["action"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "notify_user",
      description: "Create and list lightweight notification entries.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          level: { type: "string" },
          list: { type: "boolean" },
          limit: { type: "number" }
        },
        required: []
      }
    }
  }
];

async function executeAgentTool(req, callName, args) {
  switch (callName) {
    case "list_tools": {
      const result = {
        tools: agentToolDefinitions.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description
        }))
      };
      await appendAuditLog(req, "agent-tool", { name: callName, count: result.tools.length });
      return result;
    }
    case "list_apis": {
      const result = {
        apis: [
          { method: "GET", path: "/api/config", purpose: "Runtime model/provider configuration" },
          { method: "POST", path: "/api/chat", purpose: "Chat endpoint (supports agentMode for OpenAI and xAI)" },
          { method: "GET", path: "/api/tools", purpose: "Tool catalog and capabilities" },
          { method: "GET", path: "/api/notifications?limit=...", purpose: "Recent notify_user entries" },
          { method: "GET", path: "/api/files/list?path=...", purpose: "List directory" },
          { method: "GET", path: "/api/files/read?path=...", purpose: "Read file" },
          { method: "POST", path: "/api/files/write", purpose: "Write file" },
          { method: "POST", path: "/api/files/upload", purpose: "Upload file(s)" },
          { method: "GET", path: "/api/files/download?path=...", purpose: "Download file" },
          { method: "POST", path: "/api/files/move", purpose: "Move path" },
          { method: "POST", path: "/api/files/rename", purpose: "Rename path" },
          { method: "DELETE", path: "/api/files/delete?path=...", purpose: "Delete path" },
          { method: "POST", path: "/api/files/mkdir", purpose: "Create directory" },
          { method: "POST", path: "/api/files/format", purpose: "Format code/text" },
          { method: "POST", path: "/api/files/lint", purpose: "Lint JS/TS" },
          { method: "GET", path: "/api/files/audit?limit=...", purpose: "Audit log entries" },
          { method: "GET", path: "/api/files/git/log?limit=...", purpose: "Git snapshot history" },
          { method: "POST", path: "/api/files/git/revert", purpose: "Revert sandbox" },
          { method: "GET", path: "/api/files/snapshots?limit=...", purpose: "List snapshots" },
          { method: "POST", path: "/api/files/snapshots", purpose: "Create snapshot" },
          { method: "POST", path: "/api/files/snapshots/restore", purpose: "Restore snapshot" },
          { method: "GET", path: "/api/files/diff?left=...&right=...", purpose: "Diff refs" },
          { method: "POST", path: "/api/files/diff/paths", purpose: "Diff two paths" },
          { method: "POST", path: "/api/files/merge/from-snapshot", purpose: "Merge file from snapshot" },
          { method: "GET", path: "/api/files/search?q=...&mode=...", purpose: "Search files" },
          { method: "GET", path: "/api/tests/profiles", purpose: "List test profiles" },
          { method: "POST", path: "/api/tests/run", purpose: "Run test profile" }
        ]
      };
      await appendAuditLog(req, "agent-tool", { name: callName, count: result.apis.length });
      return result;
    }
    case "tool_status": {
      const targetName = String(args?.name || "").trim();
      const limit = Math.max(1, Math.min(100, Number(args?.limit || 10)));
      const entries = await readAuditEntries(500);
      const toolEntries = entries.filter((entry) => entry?.operation === "agent-tool");
      const filtered = targetName
        ? toolEntries.filter((entry) => String(entry?.details?.name || "") === targetName)
        : toolEntries;
      const recentRuns = filtered.slice(0, limit).map((entry) => ({
        timestamp: entry.timestamp,
        tool: entry?.details?.name || "",
        details: entry.details || {}
      }));

      const lastRunByTool = {};
      for (const entry of toolEntries) {
        const toolName = String(entry?.details?.name || "").trim();
        if (!toolName || lastRunByTool[toolName]) {
          continue;
        }
        lastRunByTool[toolName] = entry.timestamp;
      }

      const result = {
        name: targetName || null,
        hasRun: filtered.length > 0,
        lastRunAt: filtered[0]?.timestamp || null,
        runCountInWindow: filtered.length,
        recentRuns,
        lastRunByTool: targetName ? undefined : lastRunByTool
      };
      await appendAuditLog(req, "agent-tool", { name: callName, targetName: targetName || null, count: recentRuns.length });
      return result;
    }
    case "list_directory": {
      const result = await getFileList(args?.path || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path });
      return result;
    }
    case "read_file": {
      const result = await readTextFile(args?.path || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path });
      return result;
    }
    case "write_file": {
      const result = await writeTextFile(args?.path || "", args?.content || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path });
      return result;
    }
    case "format_code": {
      const result = await formatTextFile(args?.path || "", args?.content || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: args?.path || "" });
      return result;
    }
    case "lint_code": {
      const result = await lintTextFile(args?.path || "", args?.content || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: args?.path || "", issueCount: result.issueCount });
      return result;
    }
    case "search_web": {
      const query = String(args?.query || "").trim();
      const limit = Math.max(1, Math.min(10, Number(args?.limit || 5)));
      const [stackOverflow, duckduckgo] = await Promise.all([
        searchStackOverflow(query, limit),
        searchDuckDuckGo(query, limit)
      ]);
      const result = { query, stackOverflow, duckduckgo };
      await appendAuditLog(req, "agent-tool", { name: callName, query, stackCount: stackOverflow.length, webCount: duckduckgo.length });
      return result;
    }
    case "fetch_webpage": {
      const url = String(args?.url || "").trim();
      if (!isHttpUrl(url)) {
        throw new Error("url must start with http:// or https://");
      }
      const maxChars = Math.max(500, Math.min(50000, Number(args?.maxChars || 12000)));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), agentWebTimeoutMs);
      try {
        const response = await fetch(url, { signal: controller.signal });
        const text = await response.text();
        const content = stripHtml(text).slice(0, maxChars);
        const result = {
          url,
          status: response.status,
          title: (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
          content
        };
        await appendAuditLog(req, "agent-tool", { name: callName, url, status: response.status });
        return result;
      } finally {
        clearTimeout(timer);
      }
    }
    case "delete_file": {
      const result = await deleteSandboxPath(args?.path || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path });
      return result;
    }
    case "rename_file": {
      const result = await renameSandboxPath(args?.fromPath || "", args?.toPath || "");
      await appendAuditLog(req, "agent-tool", { name: callName, fromPath: result.fromPath, toPath: result.toPath });
      return result;
    }
    case "create_directory": {
      const result = await createSandboxDirectory(args?.path || "");
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path });
      return result;
    }
    case "zip_unzip": {
      const action = String(args?.action || "").trim().toLowerCase();
      const result = action === "zip"
        ? await zipSandboxPath(args?.sourcePath || "", args?.archivePath || "")
        : action === "unzip"
          ? await unzipSandboxArchive(args?.archivePath || "", args?.targetPath || "")
          : (() => {
              throw new Error("action must be zip or unzip");
            })();
      await appendAuditLog(req, "agent-tool", { name: callName, action, result });
      return result;
    }
    case "run_terminal": {
      const result = await runSafeTerminalCommand(args?.command, args?.args, args?.cwd, args?.timeoutMs);
      await appendAuditLog(req, "agent-tool", { name: callName, command: result.command, ok: result.ok, cwd: result.cwd });
      return result;
    }
    case "git_ops": {
      const result = await runGitOperation(args?.action, args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, action: args?.action || "", ok: result.ok });
      return result;
    }
    case "preview_markdown": {
      let markdown = typeof args?.markdown === "string" ? args.markdown : "";
      if (!markdown && args?.path) {
        const file = await readTextFile(args.path);
        markdown = file.content;
      }
      const html = renderMarkdownToHtml(markdown);
      const result = { ok: true, html };
      await appendAuditLog(req, "agent-tool", { name: callName, path: args?.path || null, length: markdown.length });
      return result;
    }
    case "convert_format": {
      const from = String(args?.from || "").trim().toLowerCase();
      const to = String(args?.to || "").trim().toLowerCase();
      const content = String(args?.content || "");
      let converted;

      if (from === "markdown" && to === "html") {
        converted = renderMarkdownToHtml(content);
      } else if (from === "html" && to === "text") {
        converted = stripHtml(content);
      } else if (from === "csv" && to === "json") {
        converted = JSON.stringify(csvToJson(content), null, 2);
      } else if (from === "json" && to === "csv") {
        converted = jsonToCsv(JSON.parse(content));
      } else if (from === "json" && to === "text") {
        converted = JSON.stringify(JSON.parse(content), null, 2);
      } else {
        throw new Error("Unsupported conversion. Try markdown->html, html->text, csv->json, json->csv, json->text.");
      }

      const result = { ok: true, from, to, output: converted };
      await appendAuditLog(req, "agent-tool", { name: callName, from, to, inputLength: content.length, outputLength: converted.length });
      return result;
    }
    case "process_image": {
      const result = await processImageFile(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, inputPath: result.inputPath, outputPath: result.outputPath });
      return result;
    }
    case "search_replace": {
      const result = await searchReplaceInFiles(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path, filesChanged: result.filesChanged, replacementCount: result.replacementCount });
      return result;
    }
    case "export_import_workspace": {
      const result = await exportImportWorkspace(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, action: args?.action || "", result });
      return result;
    }
    case "test_api": {
      const result = await testApiEndpoint(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, url: args?.url || "", status: result.status, ok: result.ok });
      return result;
    }
    case "call_api": {
      const result = await callInternalApiFromAgent(args || {});
      await appendAuditLog(req, "agent-tool", {
        name: callName,
        path: result.path,
        method: result.method,
        status: result.status,
        ok: result.ok
      });
      return result;
    }
    case "manage_permissions": {
      const result = await manageSandboxPermissions(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, path: result.path, mode: result.mode, recursive: result.recursive });
      return result;
    }
    case "manage_snapshots": {
      const action = String(args?.action || "").trim().toLowerCase();
      if (action === "list") {
        const limit = Math.max(1, Math.min(200, Number(args?.limit || 30)));
        const snapshots = await listGitSnapshots(limit);
        const result = { ok: true, action, snapshots };
        await appendAuditLog(req, "agent-tool", { name: callName, action, count: snapshots.length });
        return result;
      }
      if (action === "create") {
        const snapshot = await createManualSnapshot(String(args?.message || "").trim());
        const result = { ok: true, action, snapshot };
        await appendAuditLog(req, "agent-tool", { name: callName, action, hash: snapshot?.hash || null });
        return result;
      }
      if (action === "restore") {
        const result = await restoreSnapshot(String(args?.ref || "").trim() || "HEAD~1");
        await appendAuditLog(req, "agent-tool", { name: callName, action, ref: result.ref });
        return result;
      }
      throw new Error("action must be list, create, or restore");
    }
    case "diff_merge": {
      const action = String(args?.action || "").trim().toLowerCase();
      if (action === "diff_refs") {
        const result = await getGitDiffBetweenRefs(args?.left, args?.right, args?.path);
        await appendAuditLog(req, "agent-tool", {
          name: callName,
          action,
          left: result.left,
          right: result.right,
          path: result.path || ""
        });
        return result;
      }
      if (action === "diff_paths") {
        const leftPath = String(args?.leftPath || "").trim();
        const rightPath = String(args?.rightPath || "").trim();
        if (!leftPath || !rightPath) {
          throw new Error("leftPath and rightPath are required for diff_paths");
        }
        const result = await getPathDiffNoIndex(leftPath, rightPath);
        await appendAuditLog(req, "agent-tool", { name: callName, action, leftPath: result.leftPath, rightPath: result.rightPath });
        return result;
      }
      if (action === "merge_from_snapshot") {
        const result = await mergePathFromSnapshot(args?.ref, args?.path);
        await appendAuditLog(req, "agent-tool", { name: callName, action, ref: result.ref, path: result.path });
        return result;
      }
      throw new Error("action must be diff_refs, diff_paths, or merge_from_snapshot");
    }
    case "search_workspace": {
      const result = await searchSandboxContent(args || {});
      await appendAuditLog(req, "agent-tool", {
        name: callName,
        query: result.query,
        mode: result.mode,
        path: result.path,
        filesScanned: result.filesScanned,
        resultCount: result.resultCount
      });
      return result;
    }
    case "run_tests": {
      const action = String(args?.action || "").trim().toLowerCase();
      if (action === "list_profiles") {
        const profiles = [
          {
            profile: "npm-test",
            command: "npm test",
            description: "Run project npm test script",
            supportedCwd: ["project", "sandbox"]
          },
          {
            profile: "npm-lint",
            command: "npm run lint",
            description: "Run lint script if configured",
            supportedCwd: ["project", "sandbox"]
          },
          {
            profile: "node-test",
            command: "node --test",
            description: "Run Node built-in test runner",
            supportedCwd: ["project", "sandbox"]
          }
        ];
        await appendAuditLog(req, "agent-tool", { name: callName, action, count: profiles.length });
        return { ok: true, action, profiles };
      }
      if (action === "run") {
        const result = await runAutomatedTestProfile({
          profile: args?.profile,
          timeoutMs: args?.timeoutMs,
          cwd: args?.cwd
        });
        await appendAuditLog(req, "agent-tool", {
          name: callName,
          action,
          profile: result.profile,
          cwd: result.cwd,
          exitCode: result.exitCode,
          ok: result.ok,
          failureCount: result.failures.length
        });
        return result;
      }
      throw new Error("action must be list_profiles or run");
    }
    case "schedule_task": {
      const action = String(args?.action || "").trim().toLowerCase();
      if (action === "list") {
        return { ok: true, tasks: listScheduledTasks() };
      }
      if (action === "cancel") {
        const id = String(args?.id || "").trim();
        if (!id || !scheduledTasks.has(id)) {
          throw new Error("task id not found");
        }
        const task = scheduledTasks.get(id);
        clearTimeout(task.timer);
        task.status = "cancelled";
        scheduledTasks.set(id, task);
        await appendAuditLog(req, "agent-tool", { name: callName, action, id });
        return { ok: true, id, status: "cancelled" };
      }
      if (action === "create") {
        const tool = String(args?.tool || "").trim();
        if (!tool || tool === "schedule_task") {
          throw new Error("tool is required and cannot be schedule_task");
        }
        const toolArgs = args?.args && typeof args.args === "object" ? args.args : {};
        const delayMs = Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(args?.delayMs || 60000)));
        const id = `task-${Date.now()}-${scheduledTaskCounter++}`;
        const createdAt = new Date().toISOString();
        const runAt = new Date(Date.now() + delayMs).toISOString();

        const timer = setTimeout(async () => {
          const task = scheduledTasks.get(id);
          if (!task || task.status !== "scheduled") {
            return;
          }
          task.status = "running";
          scheduledTasks.set(id, task);
          const syntheticReq = { ip: "scheduler", headers: { "user-agent": "scheduler" } };
          try {
            const result = await executeAgentTool(syntheticReq, tool, toolArgs);
            task.status = "completed";
            task.resultSummary = JSON.stringify(result).slice(0, 1000);
            await createNotification(syntheticReq, `Scheduled task ${id} completed: ${tool}`, "success");
          } catch (error) {
            task.status = "failed";
            task.resultSummary = String(error?.message || error).slice(0, 1000);
            await createNotification(syntheticReq, `Scheduled task ${id} failed: ${tool}`, "error");
          }
          scheduledTasks.set(id, task);
        }, delayMs);

        scheduledTasks.set(id, {
          id,
          tool,
          args: toolArgs,
          delayMs,
          createdAt,
          runAt,
          status: "scheduled",
          timer,
          resultSummary: null
        });
        await appendAuditLog(req, "agent-tool", { name: callName, action, id, tool, delayMs });
        return { ok: true, id, tool, runAt };
      }
      throw new Error("action must be create, list, or cancel");
    }
    case "notify_user": {
      if (Boolean(args?.list)) {
        const limit = Math.max(1, Math.min(100, Number(args?.limit || 20)));
        return { ok: true, notifications: notificationStore.slice(0, limit) };
      }
      const message = String(args?.message || "").trim();
      if (!message) {
        throw new Error("message is required unless list=true");
      }
      const note = await createNotification(req, message, String(args?.level || "info"));
      await appendAuditLog(req, "agent-tool", { name: callName, id: note.id, level: note.level });
      return { ok: true, notification: note };
    }
    default:
      throw new Error(`Unknown tool: ${callName}`);
  }
}

function resolveAgentStepBudget(req) {
  const inputError = (message) => {
    const error = new Error(message);
    error.status = 400;
    throw error;
  };

  const requestedRaw = req.body?.agentMaxStepsOverride ?? req.body?.agentStepOverride?.steps;
  if (requestedRaw == null || requestedRaw === "") {
    return { maxSteps: agentMaxSteps, override: false };
  }

  const requested = Number(requestedRaw);
  if (!Number.isInteger(requested) || requested < 1) {
    inputError("agentMaxStepsOverride must be a positive integer");
  }

  const security = getEffectiveSecuritySettingsSync();
  const overrideCode = security.agentMaxStepsOverrideCode;

  if (requested <= agentMaxSteps) {
    return { maxSteps: requested, override: false };
  }

  if (requested > agentMaxStepsOverrideLimit) {
    inputError(`agentMaxStepsOverride exceeds limit (${agentMaxStepsOverrideLimit})`);
  }

  if (!overrideCode) {
    inputError("agent step override is not enabled on this server");
  }

  const providedCode = String(
    req.body?.agentMaxStepsOverrideCode
      || req.body?.agentStepOverride?.code
      || req.headers["x-agent-step-override-code"]
      || ""
  ).trim();

  if (!providedCode || providedCode !== overrideCode) {
    inputError("invalid agent step override code");
  }

  return { maxSteps: requested, override: true };
}

function assertNotAborted(req) {
  if (req?.abortSignal?.aborted) {
    const error = new Error("Chat job cancelled");
    error.status = 499;
    error.cancelled = true;
    throw error;
  }
}

function emitJobProgress(req, type, payload = {}) {
  if (typeof req?.onJobEvent === "function") {
    try {
      req.onJobEvent(type, payload);
    } catch {
      // Ignore event callback errors.
    }
  }
}

async function runOpenAiAgentWithTools(req, model, messages, maxSteps = agentMaxSteps) {
  const executedTools = [];
  const traceId = resolveRequestTraceId(req) || createTraceId();
  const latestUserText = [...messages]
    .reverse()
    .find((item) => item.role === "user")?.content || "";
  const likelyToolIntent = /\b(create|write|edit|update|delete|remove|rename|move|read|list|file|folder|directory|search|fetch|format|lint|zip|unzip|git|api|permission|schedule|notify|snapshot|restore|rollback|revert|diff|merge|test|testing|suite)\b/i.test(latestUserText);
  let nudgedForToolUse = false;
  const conversation = [
    {
      role: "system",
      content: "You are a coding agent. If the user asks for file operations, web/API fetches, git operations, conversions, scheduling, or notifications, you must call the appropriate tool first and then summarize the real result. Never simulate tool calls or describe hypothetical actions as completed."
    },
    ...messages.map((item) => ({ role: item.role, content: item.content }))
  ];

  for (let step = 0; step < maxSteps; step += 1) {
    assertNotAborted(req);
    emitJobProgress(req, "agent-step", { step: step + 1, maxSteps, provider: "openai", traceId });
    const completion = await client.chat.completions.create({
      model,
      messages: conversation,
      tools: agentToolDefinitions,
      tool_choice: "auto"
    });

    const assistant = completion.choices?.[0]?.message;
    if (!assistant) {
      break;
    }

    if (Array.isArray(assistant.tool_calls) && assistant.tool_calls.length > 0) {
      conversation.push({
        role: "assistant",
        content: assistant.content || "",
        tool_calls: assistant.tool_calls
      });

      for (const toolCall of assistant.tool_calls) {
        assertNotAborted(req);
        const name = toolCall?.function?.name;
        let args = {};
        try {
          args = JSON.parse(toolCall?.function?.arguments || "{}");
        } catch {
          args = {};
        }

        const startedAt = Date.now();
        let output;
        let ok = true;
        emitJobProgress(req, "tool-start", {
          provider: "openai",
          name: String(name || ""),
          args: sanitizeAuditPayload(args),
          traceId
        });
        try {
          output = await executeAgentTool(req, name, args);
          executedTools.push(name);
        } catch (error) {
          output = { error: String(error?.message || error) };
          ok = false;
          executedTools.push(`${name}:error`);
          await appendAuditLog(req, "agent-tool-error", {
            name: String(name || ""),
            traceId,
            args,
            error: String(error?.message || error)
          });
        }

        const durationMs = Date.now() - startedAt;
        await appendAuditLog(req, "agent-tool-record", {
          name: String(name || ""),
          traceId,
          ok,
          durationMs,
          args: sanitizeAuditPayload(args),
          output: sanitizeAuditPayload(output)
        });
        emitJobProgress(req, "tool-end", {
          provider: "openai",
          name: String(name || ""),
          ok,
          durationMs,
          output: sanitizeAuditPayload(output),
          traceId
        });

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(output)
        });
      }

      continue;
    }

    if (likelyToolIntent && executedTools.length === 0 && !nudgedForToolUse) {
      nudgedForToolUse = true;
      conversation.push({
        role: "system",
        content: "The user request requires real tool execution. Call at least one relevant tool now before giving a final answer."
      });
      continue;
    }

    return { text: assistant.content || "", executedTools };
  }

  try {
    conversation.push({
      role: "system",
      content: "Tool execution budget has been reached. Do not call tools. Provide a concise final answer summarizing completed actions, outputs, and any remaining blockers."
    });

    const finalize = await client.chat.completions.create({
      model,
      messages: conversation,
      tools: agentToolDefinitions,
      tool_choice: "none"
    });
    const finalAssistant = finalize.choices?.[0]?.message;
    const finalText = String(finalAssistant?.content || "").trim();
    if (finalText) {
      return { text: finalText, executedTools };
    }
  } catch {
    // Fall through to deterministic fallback message.
  }

  const count = executedTools.length;
  return {
    text: count > 0
      ? `Agent step limit reached after executing ${count} tool call(s). Please ask me to continue from current state.`
      : "Reached agent step limit before producing a final answer.",
    executedTools
  };
}

async function createXaiChatCompletion(model, conversation, options = {}) {
  const payload = {
    model,
    messages: conversation,
    ...options
  };
  const abortSignal = options.abortSignal;
  if (Object.prototype.hasOwnProperty.call(payload, "abortSignal")) {
    delete payload.abortSignal;
  }

  const response = await fetch(`${xaiApiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${xaiApiKey}`
    },
    signal: abortSignal,
    body: JSON.stringify(payload)
  });

  const rawBody = await response.text();
  const data = (() => {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  })();

  if (!response.ok) {
    const details = data?.error?.message
      || data?.message
      || rawBody
      || `HTTP ${response.status}`;
    const error = new Error(`xAI request failed: ${details}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function runXaiAgentWithTools(req, model, messages, maxSteps = agentMaxSteps, reasoningEffort = null) {
  const executedTools = [];
  const traceId = resolveRequestTraceId(req) || createTraceId();
  const latestUserText = [...messages]
    .reverse()
    .find((item) => item.role === "user")?.content || "";
  const likelyToolIntent = /\b(create|write|edit|update|delete|remove|rename|move|read|list|file|folder|directory|search|fetch|format|lint|zip|unzip|git|api|permission|schedule|notify|snapshot|restore|rollback|revert|diff|merge|test|testing|suite)\b/i.test(latestUserText);
  let nudgedForToolUse = false;
  const conversation = [
    {
      role: "system",
      content: "You are a coding agent. If the user asks for file operations, web/API fetches, git operations, conversions, scheduling, or notifications, you must call the appropriate tool first and then summarize the real result. Never simulate tool calls or describe hypothetical actions as completed."
    },
    ...messages.map((item) => ({ role: item.role, content: item.content }))
  ];

  for (let step = 0; step < maxSteps; step += 1) {
    assertNotAborted(req);
    emitJobProgress(req, "agent-step", { step: step + 1, maxSteps, provider: "xai", traceId });
    const completion = await createXaiChatCompletion(model, conversation, {
      tools: agentToolDefinitions,
      tool_choice: "auto",
      abortSignal: req?.abortSignal,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    });

    const assistant = completion?.choices?.[0]?.message;
    if (!assistant) {
      break;
    }

    if (Array.isArray(assistant.tool_calls) && assistant.tool_calls.length > 0) {
      conversation.push({
        role: "assistant",
        content: assistant.content || "",
        tool_calls: assistant.tool_calls
      });

      for (const toolCall of assistant.tool_calls) {
        assertNotAborted(req);
        const name = toolCall?.function?.name;
        let args = {};
        try {
          args = JSON.parse(toolCall?.function?.arguments || "{}");
        } catch {
          args = {};
        }

        const startedAt = Date.now();
        let output;
        let ok = true;
        emitJobProgress(req, "tool-start", {
          provider: "xai",
          name: String(name || ""),
          args: sanitizeAuditPayload(args),
          traceId
        });
        try {
          output = await executeAgentTool(req, name, args);
          executedTools.push(name);
        } catch (error) {
          output = { error: String(error?.message || error) };
          ok = false;
          executedTools.push(`${name}:error`);
          await appendAuditLog(req, "agent-tool-error", {
            name: String(name || ""),
            traceId,
            args,
            error: String(error?.message || error)
          });
        }

        const durationMs = Date.now() - startedAt;
        await appendAuditLog(req, "agent-tool-record", {
          name: String(name || ""),
          traceId,
          ok,
          durationMs,
          args: sanitizeAuditPayload(args),
          output: sanitizeAuditPayload(output)
        });
        emitJobProgress(req, "tool-end", {
          provider: "xai",
          name: String(name || ""),
          ok,
          durationMs,
          output: sanitizeAuditPayload(output),
          traceId
        });

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(output)
        });
      }

      continue;
    }

    if (likelyToolIntent && executedTools.length === 0 && !nudgedForToolUse) {
      nudgedForToolUse = true;
      conversation.push({
        role: "system",
        content: "The user request requires real tool execution. Call at least one relevant tool now before giving a final answer."
      });
      continue;
    }

    return { text: assistant.content || "", executedTools };
  }

  try {
    conversation.push({
      role: "system",
      content: "Tool execution budget has been reached. Do not call tools. Provide a concise final answer summarizing completed actions, outputs, and any remaining blockers."
    });

    const finalize = await createXaiChatCompletion(model, conversation, {
      tools: agentToolDefinitions,
      tool_choice: "none",
      abortSignal: req?.abortSignal,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    });
    const finalAssistant = finalize?.choices?.[0]?.message;
    const finalText = String(finalAssistant?.content || "").trim();
    if (finalText) {
      return { text: finalText, executedTools };
    }
  } catch {
    // Fall through to deterministic fallback message.
  }

  const count = executedTools.length;
  return {
    text: count > 0
      ? `Agent step limit reached after executing ${count} tool call(s). Please ask me to continue from current state.`
      : "Reached agent step limit before producing a final answer.",
    executedTools
  };
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://esm.sh"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", appBaseUrl, "https://esm.sh"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  const traceId = resolveRequestTraceId(req) || createTraceId();
  req.traceId = traceId;
  res.setHeader("x-trace-id", traceId);
  next();
});

app.use((req, res, next) => {
  const queryCode = normalizeWorkspaceCode(req.query?.access_code || req.query?.workspace || req.query?.code);
  if (queryCode) {
    if (allowedWorkspaceCodes.length > 0 && !allowedWorkspaceCodes.includes(queryCode)) {
      return res.status(403).send("Invalid workspace code.");
    }
    setWorkspaceCookie(res, queryCode);
  }
  next();
});

const authEnabled = String(process.env.ENABLE_BASIC_AUTH).toLowerCase() === "true";
const authUser = process.env.BASIC_AUTH_USER || "";
const authPass = process.env.BASIC_AUTH_PASS || "";

if (authEnabled) {
  app.use((req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Basic ")) {
      res.set("WWW-Authenticate", "Basic realm=Remote AI Access");
      return res.status(401).send("Authentication required.");
    }

    const encoded = header.slice(6).trim();
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sepIndex = decoded.indexOf(":");
    const user = sepIndex >= 0 ? decoded.slice(0, sepIndex) : "";
    const pass = sepIndex >= 0 ? decoded.slice(sepIndex + 1) : "";

    if (user !== authUser || pass !== authPass) {
      return res.status(401).send("Invalid credentials.");
    }

    next();
  });
}

app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use("/api", (req, res, next) => {
  const security = getEffectiveSecuritySettingsSync();
  if (!security.apiKeyAuthEnabled || security.apiKeys.length === 0) {
    next();
    return;
  }

  const pathname = new URL(req.originalUrl || req.url || "/", appBaseUrl).pathname;
  const protectedRoute = pathMatchesAnyPrefix(pathname, security.apiKeyProtectedPathPrefixes);
  if (!protectedRoute) {
    next();
    return;
  }

  const exemptRoute = pathMatchesAnyPrefix(pathname, security.apiKeyExemptPathPrefixes);
  if (exemptRoute) {
    next();
    return;
  }

  const headerValue = String(req.headers[security.apiKeyHeaderName] || "").trim();
  const providedKey = headerValue;

  if (!providedKey || !security.apiKeys.includes(providedKey)) {
    const hint = security.apiKeyRequireHeaderOnly
      ? `Provide header ${security.apiKeyHeaderName}`
      : `Provide header ${security.apiKeyHeaderName}`;
    return res.status(401).json({
      error: "API key required for this endpoint",
      hint
    });
  }

  next();
});

app.use("/api", (req, res, next) => {
  const workspaceCode = resolveRequestedWorkspaceCode(req);
  if (!workspaceCode) {
    return res.status(403).json({ error: "workspace access code is not allowed" });
  }

  const context = workspaceContextForCode(workspaceCode);
  if (normalizeWorkspaceCode(req.query?.access_code || req.query?.workspace || req.query?.code) && workspaceCode) {
    setWorkspaceCookie(res, workspaceCode);
  }

  workspaceContextStore.run(context, async () => {
    try {
      await ensureSandboxReady();
      const autoBranch = await ensureWorkspaceSessionBranch();
      req.workspace = {
        code: context.code,
        sandboxRoot: context.sandboxRoot,
        autoSessionBranch: autoBranch || null
      };
      next();
    } catch (error) {
      next(error);
    }
  });
});

app.use("/api/admin", (req, res, next) => {
  if (!adminDashboardToken) {
    return res.status(503).json({ error: "Admin dashboard is disabled: set ADMIN_DASHBOARD_TOKEN" });
  }

  const provided = String(req.headers["x-admin-token"] || "").trim();
  if (!provided || provided !== adminDashboardToken) {
    return res.status(403).json({ error: "Invalid admin token" });
  }

  next();
});

app.get("/api/admin/security", async (_req, res) => {
  try {
    const settings = await loadAdminSecuritySettings();
    return res.json({
      apiKeyAuthEnabled: Boolean(settings.apiKeyAuthEnabled),
      apiKeyHeaderName: String(settings.apiKeyHeaderName || "x-api-key").trim().toLowerCase() || "x-api-key",
      apiKeys: normalizeApiKeyList(settings.apiKeys),
      apiKeyProtectedPathPrefixes: normalizePathPrefixList(settings.apiKeyProtectedPathPrefixes),
      apiKeyExemptPathPrefixes: normalizePathPrefixList(settings.apiKeyExemptPathPrefixes),
      apiKeyRequireHeaderOnly: settings.apiKeyRequireHeaderOnly !== false,
      agentMaxStepsOverrideCode: String(settings.agentMaxStepsOverrideCode || "").trim(),
      workspaceUploadBypassCodesRaw: String(settings.workspaceUploadBypassCodesRaw || ""),
      updatedAt: settings.updatedAt || null,
      settingsDbPath: adminSettingsDbPath
    });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || "Failed to read admin security settings") });
  }
});

app.put("/api/admin/security", async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const update = {
      apiKeyAuthEnabled: payload.apiKeyAuthEnabled,
      apiKeyHeaderName: payload.apiKeyHeaderName,
      apiKeys: payload.apiKeys,
      apiKeyProtectedPathPrefixes: payload.apiKeyProtectedPathPrefixes,
      apiKeyExemptPathPrefixes: payload.apiKeyExemptPathPrefixes,
      apiKeyRequireHeaderOnly: payload.apiKeyRequireHeaderOnly,
      agentMaxStepsOverrideCode: payload.agentMaxStepsOverrideCode,
      workspaceUploadBypassCodesRaw: payload.workspaceUploadBypassCodesRaw
    };

    const saved = await saveAdminSecuritySettings(update);
    return res.json({
      ok: true,
      settings: {
        apiKeyAuthEnabled: Boolean(saved.apiKeyAuthEnabled),
        apiKeyHeaderName: String(saved.apiKeyHeaderName || "x-api-key").trim().toLowerCase() || "x-api-key",
        apiKeys: normalizeApiKeyList(saved.apiKeys),
        apiKeyProtectedPathPrefixes: normalizePathPrefixList(saved.apiKeyProtectedPathPrefixes),
        apiKeyExemptPathPrefixes: normalizePathPrefixList(saved.apiKeyExemptPathPrefixes),
        apiKeyRequireHeaderOnly: saved.apiKeyRequireHeaderOnly !== false,
        agentMaxStepsOverrideCode: String(saved.agentMaxStepsOverrideCode || "").trim(),
        workspaceUploadBypassCodesRaw: String(saved.workspaceUploadBypassCodesRaw || ""),
        updatedAt: saved.updatedAt || null,
        settingsDbPath: adminSettingsDbPath
      }
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to save admin security settings") });
  }
});

app.use(
  "/api/chat",
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS."));
    },
    methods: ["POST"],
    allowedHeaders: ["Content-Type", "X-Workspace-Code", "X-API-Key"]
  })
);

app.get("/api/session/workspace", async (req, res) => {
  const context = getWorkspaceContext();
  const currentBranch = await getCurrentBranchName().catch(() => "");
  const host = workspaceGitSshHost || String(req.headers.host || "").split(":")[0].trim() || "";
  const remoteSshUrl = host
    ? `${workspaceGitSshUser}@${host}:${String(context.bareRepoPath || "").replaceAll("\\", "/")}`
    : "";
  res.json({
    workspaceCode: context.code,
    cookieName: workspaceCookieName,
    constrainedByAllowList: allowedWorkspaceCodes.length > 0,
    autoSessionBranching: enableAutoSessionBranching,
    currentBranch: currentBranch || workspaceBranchState.get(context.code) || null,
    gitRemote: {
      remoteName: workspaceGitRemoteName,
      remotePath: context.bareRepoPath,
      remoteSshUrl
    }
  });
});

app.post("/api/session/workspace", (req, res) => {
  const code = normalizeWorkspaceCode(req.body?.accessCode || req.body?.workspaceCode || req.body?.code);
  if (!code) {
    return res.status(400).json({ error: "accessCode is required (letters, numbers, _ or -)" });
  }
  if (allowedWorkspaceCodes.length > 0 && !allowedWorkspaceCodes.includes(code)) {
    return res.status(403).json({ error: "workspace access code is not allowed" });
  }
  setWorkspaceCookie(res, code);
  return res.json({ ok: true, workspaceCode: code });
});

app.get("/api/session/workspace/git", async (req, res, next) => {
  try {
    const info = await ensureWorkspaceGitRemoteSetup(req);
    return res.json({
      workspaceCode: getWorkspaceContext().code,
      ...info
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/session/workspace/git/pull", async (req, res, next) => {
  try {
    const info = await ensureWorkspaceGitRemoteSetup(req);
    const result = await pullWorkspaceFromRemote({
      remoteName: req.body?.remoteName || info.remoteName,
      branch: req.body?.branch,
      strategy: req.body?.strategy
    });
    await appendAuditLog(req, "workspace-git-pull", {
      remoteName: result.remote,
      branch: result.branch,
      strategy: result.strategy,
      head: result.head
    });
    return res.json({ workspaceCode: getWorkspaceContext().code, ...info, ...result });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/session/workspace/git/push", async (req, res, next) => {
  try {
    const info = await ensureWorkspaceGitRemoteSetup(req);
    const result = await pushWorkspaceToRemote({
      remoteName: req.body?.remoteName || info.remoteName,
      branch: req.body?.branch,
      setUpstream: req.body?.setUpstream,
      forceWithLease: req.body?.forceWithLease
    });
    await appendAuditLog(req, "workspace-git-push", {
      remoteName: result.remote,
      branch: result.branch,
      ok: result.ok
    });
    return res.json({ workspaceCode: getWorkspaceContext().code, ...info, ...result });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/session/branch", async (req, res, next) => {
  try {
    const branch = await getCurrentBranchName();
    return res.json({
      workspaceCode: getWorkspaceContext().code,
      branch,
      autoSessionBranching: enableAutoSessionBranching,
      suggestedAutoBranch: getAutoSessionBranchName(getWorkspaceContext().code)
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/session/branch", async (req, res, next) => {
  try {
    const branch = String(req.body?.branch || "").trim();
    if (!branch) {
      return res.status(400).json({ error: "branch is required" });
    }
    const createIfMissing = req.body?.createIfMissing !== false;
    const selected = await switchWorkspaceBranch(branch, createIfMissing);
    return res.json({ ok: true, branch: selected, workspaceCode: getWorkspaceContext().code });
  } catch (error) {
    return next(error);
  }
});

async function generateChatResponse(req) {
  const traceId = resolveRequestTraceId(req) || createTraceId();
  req.traceId = traceId;
  assertNotAborted(req);
  const provider = String(req.body?.provider || defaultProvider).trim().toLowerCase();
  const agentMode = Boolean(req.body?.agentMode);
  if (provider !== "openai" && provider !== "copilot" && provider !== "xai") {
    const error = new Error(`provider '${provider}' is not configured on this server yet`);
    error.status = 400;
    throw error;
  }

  const messages = normalizeMessages(req.body);
  if (!messages) {
    const error = new Error("messages must contain non-empty user or assistant items within size limits");
    error.status = 400;
    throw error;
  }

  if (provider === "openai") {
    if (!client) {
      const error = new Error("openai provider is not enabled: missing OPENAI_API_KEY");
      error.status = 400;
      throw error;
    }

    const model = resolveModel(req.body?.model);
    const reasoningEffort = normalizeReasoningEffort(req.body?.reasoningEffort || req.body?.reasoning_effort);
    if ((req.body?.reasoningEffort || req.body?.reasoning_effort) && !reasoningEffort) {
      const error = new Error("reasoningEffort must be one of: none, minimal, low, medium, high, xhigh");
      error.status = 400;
      throw error;
    }
    const stepBudget = agentMode ? resolveAgentStepBudget(req) : { maxSteps: agentMaxSteps, override: false };

    if (agentMode) {
      const result = await runOpenAiAgentWithTools(req, model, messages, stepBudget.maxSteps);
      return {
        reply: result.text,
        model,
        provider: "openai",
        traceId,
        agentMode: true,
        agentMaxStepsUsed: stepBudget.maxSteps,
        agentMaxStepsOverrideUsed: stepBudget.override,
        executedTools: result.executedTools
      };
    }

    const responseRequest = {
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "You are a concise, helpful assistant for work-safe usage."
            }
          ]
        },
        ...messages.map((entry) => ({
          role: entry.role,
          content: [
            {
              type: entry.role === "assistant" ? "output_text" : "input_text",
              text: entry.content
            }
          ]
        }))
      ]
    };

    if (reasoningEffort) {
      responseRequest.reasoning = { effort: reasoningEffort };
    }

    const response = await client.responses.create(responseRequest);
    const text = response.output_text || "";
    return { reply: text, model, provider: "openai", traceId, reasoningEffort: reasoningEffort || null };
  }

  if (provider === "copilot") {
    if (!githubPat) {
      const error = new Error("copilot provider is not enabled: missing GITHUB_PAT or GITHUB_TOKEN");
      error.status = 400;
      throw error;
    }

    const requestedModel = String(req.body?.model || "").trim();
    if (!isValidCopilotModelName(requestedModel)) {
      const error = new Error("copilot model must be a valid string, like openai/gpt-4.1");
      error.status = 400;
      throw error;
    }

    const copilotResponse = await fetch(`${copilotApiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "Authorization": `Bearer ${githubPat}`,
        "X-GitHub-Api-Version": copilotApiVersion
      },
      signal: req?.abortSignal,
      body: JSON.stringify({
        model: requestedModel,
        messages
      })
    });

    const rawCopilotBody = await copilotResponse.text();
    const copilotData = (() => {
      try {
        return JSON.parse(rawCopilotBody);
      } catch {
        return {};
      }
    })();

    if (!copilotResponse.ok) {
      const details = copilotData?.error?.message
        || copilotData?.message
        || rawCopilotBody
        || `HTTP ${copilotResponse.status}`;
      const error = new Error(`Copilot request failed: ${details}`);
      error.status = copilotResponse.status;
      throw error;
    }

    const text = Array.isArray(copilotData?.choices)
      ? (copilotData.choices[0]?.message?.content || "")
      : "";

    return {
      reply: typeof text === "string" ? text : JSON.stringify(text),
      model: requestedModel,
      provider: "copilot",
      traceId
    };
  }

  if (!xaiApiKey) {
    const error = new Error("xai provider is not enabled: missing XAI_API_KEY");
    error.status = 400;
    throw error;
  }

  const model = resolveXaiModel(req.body?.model);
  const reasoningEffort = normalizeReasoningEffort(req.body?.reasoningEffort || req.body?.reasoning_effort);
  if ((req.body?.reasoningEffort || req.body?.reasoning_effort) && !reasoningEffort) {
    const error = new Error("reasoningEffort must be one of: none, minimal, low, medium, high, xhigh");
    error.status = 400;
    throw error;
  }

  const stepBudget = agentMode ? resolveAgentStepBudget(req) : { maxSteps: agentMaxSteps, override: false };
  if (agentMode) {
    const result = await runXaiAgentWithTools(req, model, messages, stepBudget.maxSteps, reasoningEffort);
    return {
      reply: result.text,
      model,
      provider: "xai",
      traceId,
      agentMode: true,
      agentMaxStepsUsed: stepBudget.maxSteps,
      agentMaxStepsOverrideUsed: stepBudget.override,
      reasoningEffort: reasoningEffort || null,
      executedTools: result.executedTools
    };
  }

  const xaiBody = {
    model,
    messages
  };
  if (reasoningEffort) {
    xaiBody.reasoning_effort = reasoningEffort;
  }
  const xaiData = await createXaiChatCompletion(model, messages, {
    ...xaiBody,
    abortSignal: req?.abortSignal
  });
  const text = Array.isArray(xaiData?.choices)
    ? (xaiData.choices[0]?.message?.content || "")
    : "";

  return {
    reply: typeof text === "string" ? text : JSON.stringify(text),
    model,
    provider: "xai",
    traceId,
    reasoningEffort: reasoningEffort || null
  };
}

app.post("/api/chat", async (req, res) => {
  try {
    const result = await generateChatResponse(req);
    return res.json(result);
  } catch (error) {
    const status = error?.status || 500;
    const details = error?.message || "Unknown provider error";
    const traceId = resolveRequestTraceId(req) || createTraceId();
    console.error("Provider request failed:", details);
    const message = status >= 400 && status < 500 ? details : "Failed to generate response.";
    return res.status(status).json({ error: message, traceId });
  }
});

app.post("/api/chat/jobs", async (req, res) => {
  const provider = String(req.body?.provider || defaultProvider).trim().toLowerCase();
  const agentMode = Boolean(req.body?.agentMode);
  const job = createChatJob(req, provider, agentMode);

  const context = getWorkspaceContext();
  const abortController = new AbortController();
  const reqClone = {
    body: JSON.parse(JSON.stringify(req.body || {})),
    headers: { ...(req.headers || {}) },
    ip: req.ip,
    workspace: req.workspace || null,
    traceId: job.traceId,
    chatJobId: job.id,
    abortSignal: abortController.signal,
    onJobEvent: (type, payload) => {
      const current = chatJobStore.get(job.id);
      if (current) {
        recordChatJobEvent(current, type, payload);
      }
    }
  };

  queueMicrotask(() => {
    workspaceContextStore.run(context, async () => {
      const current = chatJobStore.get(job.id);
      if (!current) {
        return;
      }
      current.abortController = abortController;
      if (current.cancelRequested || current.status === "cancelled") {
        return;
      }
      setChatJobStatus(current, "running", { eventPayload: { provider, traceId: current.traceId } });
      try {
        const result = await generateChatResponse(reqClone);
        if (current.status !== "cancelled") {
          setChatJobStatus(current, "completed", { result, eventPayload: { traceId: current.traceId } });
        }
      } catch (error) {
        if (current.status !== "cancelled") {
          setChatJobStatus(current, "failed", {
            error: {
              message: String(error?.message || error),
              status: Number(error?.status || 500),
              traceId: current.traceId
            },
            eventPayload: { traceId: current.traceId }
          });
        }
      } finally {
        current.abortController = null;
      }
    });
  });

  return res.status(202).json({
    ok: true,
    job: getChatJobResponse(job)
  });
});

app.get("/api/chat/jobs/:jobId", async (req, res) => {
  pruneChatJobs();
  const jobId = String(req.params.jobId || "").trim();
  const job = chatJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "chat job not found" });
  }

  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "chat job belongs to a different workspace" });
  }

  return res.json({ ok: true, job: getChatJobResponse(job) });
});

app.delete("/api/chat/jobs/:jobId", async (req, res) => {
  pruneChatJobs();
  const jobId = String(req.params.jobId || "").trim();
  const job = chatJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "chat job not found" });
  }
  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "chat job belongs to a different workspace" });
  }

  const cancelled = cancelChatJob(job, "Cancelled by user");
  return res.json({ ok: true, cancelled, job: getChatJobResponse(job) });
});

app.get("/api/chat/jobs/:jobId/events", async (req, res) => {
  pruneChatJobs();
  const jobId = String(req.params.jobId || "").trim();
  const job = chatJobStore.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "chat job not found" });
  }
  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "chat job belongs to a different workspace" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const initial = {
    id: `evt-init-${Date.now()}`,
    jobId: job.id,
    traceId: job.traceId,
    type: "snapshot",
    timestamp: new Date().toISOString(),
    payload: {
      job: getChatJobResponse(job),
      events: job.events.slice(-Math.min(chatJobEventHistoryMax, 240))
    }
  };
  res.write(`id: ${initial.id}\n`);
  res.write(`event: snapshot\n`);
  res.write(`data: ${JSON.stringify(initial)}\n\n`);

  if (!(job.listeners instanceof Set)) {
    job.listeners = new Set();
  }
  job.listeners.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now(), jobId: job.id })}\n\n`);
    } catch {
      // Ignore heartbeat errors.
    }
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    job.listeners.delete(res);
  });
});

app.get("/api/config", (_req, res) => {
  const security = getEffectiveSecuritySettingsSync();
  const supportedProviders = ["openai"];
  if (githubPat) {
    supportedProviders.push("copilot");
  }
  if (xaiApiKey) {
    supportedProviders.push("xai");
  }

  res.json({
    defaultProvider,
    defaultModel,
    allowedModels,
    xaiDefaultModel,
    xaiAllowedModels,
    supportedProviders,
    agentModeSupportedProviders: xaiApiKey ? ["openai", "xai"] : ["openai"],
    agentStepOverride: {
      enabled: Boolean(security.agentMaxStepsOverrideCode),
      baseMaxSteps: agentMaxSteps,
      maxOverrideSteps: agentMaxStepsOverrideLimit
    },
    apiKeyAuth: {
      enabled: security.apiKeyAuthEnabled && security.apiKeys.length > 0,
      headerName: security.apiKeyHeaderName,
      requireHeaderOnly: security.apiKeyRequireHeaderOnly,
      protectedPathPrefixes: security.apiKeyProtectedPathPrefixes,
      exemptPathPrefixes: security.apiKeyExemptPathPrefixes
    }
  });
});

app.get("/models.csv", (_req, res) => {
  res.sendFile(modelsCsvPath);
});

app.get("/api/tools", (_req, res) => {
  const security = getEffectiveSecuritySettingsSync();
  const agentToolNames = agentToolDefinitions.map((tool) => tool.function.name);
  const context = getWorkspaceContext();
  const workspaceRemotePath = context.bareRepoPath;
  const host = workspaceGitSshHost || "<ssh-host>";
  const workspaceRemoteSshUrl = `${workspaceGitSshUser}@${host}:${String(workspaceRemotePath || "").replaceAll("\\", "/")}`;
  res.json({
    sandboxRoot: context.sandboxRoot,
    workspaceCode: context.code,
    workspaceRepository: {
      sourceOfTruth: context.sandboxRoot,
      autoSessionBranching: enableAutoSessionBranching,
      sessionBranchPrefix,
      lastKnownBranch: workspaceBranchState.get(context.code) || null
    },
    workspaceBackups: {
      enabled: enableNightlyWorkspaceBackup,
      backupRoot: workspaceBackupRoot,
      utcHour: workspaceBackupUtcHour,
      retentionDays: workspaceBackupRetentionDays
    },
    workspaceGitRemote: {
      remoteName: workspaceGitRemoteName,
      remotePath: workspaceRemotePath,
      remoteSshUrl: workspaceRemoteSshUrl
    },
    uploadPolicy: {
      defaultMaxBytes: defaultUploadMaxBytes,
      bypassHeader: "X-Upload-Bypass-Code",
      bypassConfiguredForWorkspace: security.workspaceUploadBypassCodes.has(context.code),
      chunked: {
        enabled: true,
        thresholdBytes: chunkUploadThresholdBytes,
        chunkSizeBytes: chunkUploadChunkSizeBytes,
        sessionMaxAgeMs: chunkUploadSessionMaxAgeMs
      }
    },
    apiKeyAuth: {
      enabled: security.apiKeyAuthEnabled && security.apiKeys.length > 0,
      headerName: security.apiKeyHeaderName,
      requireHeaderOnly: security.apiKeyRequireHeaderOnly,
      protectedPathPrefixes: security.apiKeyProtectedPathPrefixes,
      exemptPathPrefixes: security.apiKeyExemptPathPrefixes
    },
    terminal: {
      runtime: terminalRuntime,
      dockerImage: terminalRuntime === "docker" ? terminalDockerImage : null,
      allowedCommands: Array.from(getAllowedTerminalCommands()).sort(),
      hostFallbackCommands: Array.from(terminalHostFallbackCommands).sort(),
      vfa: {
        commandConfigured: Boolean(terminalVfaCommand),
        scriptPath: terminalVfaScript
      }
    },
    notes: [
      "All file operations are constrained to SANDBOX_ROOT and tracked in local git.",
      "Each workspace path is the source-of-truth git repository; optional auto session branches can isolate daily sessions.",
      "Each workspace also has a bare git remote at WORKSPACE_GIT_REMOTE_ROOT/<workspace>.git for fast external push/pull workflows.",
      "Optional per-workspace upload bypass codes can remove FILE_API_UPLOAD_MAX_BYTES when sent as X-Upload-Bypass-Code.",
      "Nightly workspace backups create git bundle archives and prune backups older than retention policy.",
      "Terminal tool runs with an isolated per-workspace HOME/cache/env and cannot execute host-admin commands like sudo/apt.",
      "Terminal accepts command strings such as `git clone https://github.com/org/repo.git repo`, `cd repo && grep -R TODO .`, and simple conditional chains like `pwd && ls -la && git status 2>&1 || echo no repo`.",
      "Set TERMINAL_EXTRA_COMMANDS=cmd1,cmd2 to add more allow-listed commands from server config.",
      "Archive helpers include 7z and vfa in the terminal allow-list; vfa can resolve from TERMINAL_VFA_COMMAND or TERMINAL_VFA_SCRIPT.",
      "Use /api/files/format before /api/files/write when you want prettified output.",
      "Use /api/files/git/log to inspect snapshots and /api/files/git/revert to roll back.",
      "Set agentMode=true in /api/chat (openai or xai provider) to enable automatic tool-calling."
    ],
    agentToolCalling: {
      enabled: true,
      provider: "openai",
      tools: agentToolNames
    },
    agentToolReference: [
      { toolName: "delete_file", description: "Delete file/folder", whyUseful: "Housekeeping control" },
      { toolName: "rename_file", description: "Rename/move files/folders", whyUseful: "Reorganize easily" },
      { toolName: "create_directory", description: "Create new folders", whyUseful: "Structured workspace" },
      { toolName: "zip_unzip", description: "Archive/extract files/folders", whyUseful: "Export/import, backups" },
      { toolName: "run_terminal", description: "Run safe allow-listed terminal commands", whyUseful: "Automation, scripts" },
      { toolName: "git_ops", description: "Source control actions", whyUseful: "Versioning, collaboration" },
      { toolName: "preview_markdown", description: "Render Markdown/HTML", whyUseful: "See docs/output as intended" },
      { toolName: "convert_format", description: "Change between file formats", whyUseful: "Flexibility, data handling" },
      { toolName: "process_image", description: "Basic image transformations", whyUseful: "Editing, optimization" },
      { toolName: "search_replace", description: "Regex-powered file operations", whyUseful: "Bulk edits" },
      { toolName: "export_import_workspace", description: "Save/load full project (ZIP)", whyUseful: "Sync, portability" },
      { toolName: "test_api", description: "API testing from chat", whyUseful: "Dev productivity" },
      { toolName: "call_api", description: "Call internal server API routes", whyUseful: "Reliable in-app automation" },
      { toolName: "manage_permissions", description: "Set access controls", whyUseful: "Multi-user safety" },
      { toolName: "manage_snapshots", description: "List/create/restore snapshots", whyUseful: "Safe rollback points" },
      { toolName: "diff_merge", description: "Diff refs/paths and merge file from snapshot", whyUseful: "Review + controlled apply" },
      { toolName: "search_workspace", description: "Full-text + semantic sandbox search", whyUseful: "Find relevant code fast" },
      { toolName: "run_tests", description: "List and run test profiles", whyUseful: "Validate changes quickly" },
      { toolName: "schedule_task", description: "Run actions on schedule", whyUseful: "Automation" },
      { toolName: "notify_user", description: "Send alerts/updates", whyUseful: "Responsive UX" }
    ],
    tools: [
      { method: "GET", path: "/api/openapi.json", purpose: "OpenAPI schema for external tooling and SDK generation" },
      { method: "GET", path: "/api/notifications?limit=100", purpose: "List recent notify_user notifications" },
      { method: "GET", path: "/api/session/workspace/git", purpose: "Get workspace bare git remote path/URL" },
      { method: "POST", path: "/api/session/workspace/git/pull", purpose: "Pull remote branch into workspace", body: { remoteName: "origin", branch: "main", strategy: "ff-only" } },
      { method: "POST", path: "/api/session/workspace/git/push", purpose: "Push workspace branch to remote", body: { remoteName: "origin", branch: "main", setUpstream: true } },
      { method: "GET", path: "/api/files/list?path=src", purpose: "List directory contents" },
      { method: "GET", path: "/api/files/read?path=src/app.js", purpose: "Read UTF-8 text file" },
      { method: "POST", path: "/api/files/write", purpose: "Write file text", body: { path: "src/app.js", content: "..." } },
      { method: "POST", path: "/api/files/upload", purpose: "Upload one or many files (fields: files or file, optional path and relativePaths[])" },
      { method: "GET", path: "/api/files/download?path=src/app.js", purpose: "Download a file" },
      { method: "POST", path: "/api/files/move", purpose: "Move file or directory", body: { fromPath: "old.txt", toPath: "docs/new.txt" } },
      { method: "POST", path: "/api/files/rename", purpose: "Rename in place", body: { path: "docs/a.txt", newName: "b.txt" } },
      { method: "DELETE", path: "/api/files/delete?path=docs/a.txt", purpose: "Delete file or directory recursively" },
      { method: "POST", path: "/api/files/mkdir", purpose: "Create directory", body: { path: "docs" } },
      { method: "POST", path: "/api/files/format", purpose: "Format text using Prettier", body: { path: "src/app.js", content: "...", write: false } },
      { method: "POST", path: "/api/files/lint", purpose: "Lint JS/TS code with ESLint", body: { path: "src/app.ts", content: "..." } },
      { method: "POST", path: "/api/files/terminal", purpose: "Run allow-listed command in isolated workspace terminal env", body: { command: "git clone https://github.com/org/repo.git repo && git -C repo status", cwd: "", timeoutMs: 120000 } },
      { method: "GET", path: "/api/files/audit?limit=200", purpose: "Read per-operation audit entries" },
      { method: "GET", path: "/api/files/git/log?limit=20", purpose: "List sandbox commits" },
      { method: "POST", path: "/api/files/git/revert", purpose: "Hard reset sandbox to a commit", body: { ref: "HEAD~1" } },
      { method: "GET", path: "/api/files/snapshots?limit=30", purpose: "List snapshot commits" },
      { method: "POST", path: "/api/files/snapshots", purpose: "Create manual snapshot commit", body: { message: "checkpoint before refactor" } },
      { method: "POST", path: "/api/files/snapshots/restore", purpose: "Restore sandbox snapshot", body: { ref: "HEAD~1" } },
      { method: "GET", path: "/api/files/diff?left=HEAD~1&right=HEAD&path=...", purpose: "Diff two refs for optional path" },
      { method: "POST", path: "/api/files/diff/paths", purpose: "Diff two sandbox paths", body: { leftPath: "a.txt", rightPath: "b.txt" } },
      { method: "POST", path: "/api/files/merge/from-snapshot", purpose: "Merge path from snapshot into workspace", body: { ref: "HEAD~1", path: "src/app.js" } },
      { method: "GET", path: "/api/files/search?q=term&mode=hybrid&path=src", purpose: "Full-text and semantic search in sandbox files" },
      { method: "GET", path: "/api/tests/profiles", purpose: "List automated test profiles" },
      { method: "POST", path: "/api/tests/run", purpose: "Run automated test profile", body: { profile: "npm-test", cwd: "project" } }
    ]
  });
});

app.get("/api/openapi.json", (_req, res) => {
  const security = getEffectiveSecuritySettingsSync();
  const openapi = {
    openapi: "3.1.0",
    info: {
      title: "Remote AI Access API",
      version: "1.0.0",
      description: "HTTP API for chat, workspace/file operations, tests, notifications, and admin security settings."
    },
    servers: [{ url: appBaseUrl }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: security.apiKeyHeaderName
        },
        AdminTokenAuth: {
          type: "apiKey",
          in: "header",
          name: "x-admin-token"
        }
      }
    },
    paths: {
      "/api/config": { get: { summary: "Get runtime config" } },
      "/api/tools": { get: { summary: "Get tool catalog and API metadata" } },
      "/api/openapi.json": { get: { summary: "Get OpenAPI spec" } },
      "/api/chat": {
        post: {
          summary: "Run chat completion",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object" }
              }
            }
          }
        }
      },
      "/api/session/workspace": {
        get: { summary: "Get workspace session info" },
        post: { summary: "Set active workspace" }
      },
      "/api/session/workspace/git": { get: { summary: "Get workspace git remote info" } },
      "/api/session/workspace/git/pull": { post: { summary: "Pull workspace git remote" } },
      "/api/session/workspace/git/push": { post: { summary: "Push workspace git remote" } },
      "/api/session/branch": {
        get: { summary: "Get active branch" },
        post: { summary: "Switch branch" }
      },
      "/api/notifications": { get: { summary: "List notifications" } },
      "/api/files/list": { get: { summary: "List directory" } },
      "/api/files/read": { get: { summary: "Read file" } },
      "/api/files/write": { post: { summary: "Write file" } },
      "/api/files/upload": { post: { summary: "Upload file(s)" } },
      "/api/files/upload/chunk/start": { post: { summary: "Start chunked upload session" } },
      "/api/files/upload/chunk/{uploadId}": {
        post: { summary: "Upload chunk bytes" },
        get: { summary: "Get chunk upload status" }
      },
      "/api/files/upload/chunk/{uploadId}/complete": { post: { summary: "Complete chunked upload" } },
      "/api/files/download": { get: { summary: "Download file" } },
      "/api/files/move": { post: { summary: "Move path" } },
      "/api/files/rename": { post: { summary: "Rename path" } },
      "/api/files/delete": { delete: { summary: "Delete path" } },
      "/api/files/mkdir": { post: { summary: "Create directory" } },
      "/api/files/format": { post: { summary: "Format text" } },
      "/api/files/lint": { post: { summary: "Lint text" } },
      "/api/files/terminal": { post: { summary: "Run safe terminal command" } },
      "/api/files/audit": { get: { summary: "List audit entries" } },
      "/api/files/git/log": { get: { summary: "List git commits" } },
      "/api/files/git/revert": { post: { summary: "Revert sandbox git state" } },
      "/api/files/snapshots": {
        get: { summary: "List snapshots" },
        post: { summary: "Create snapshot" }
      },
      "/api/files/snapshots/restore": { post: { summary: "Restore snapshot" } },
      "/api/files/diff": { get: { summary: "Diff refs" } },
      "/api/files/diff/paths": { post: { summary: "Diff paths" } },
      "/api/files/merge/from-snapshot": { post: { summary: "Merge file from snapshot" } },
      "/api/files/search": { get: { summary: "Search sandbox" } },
      "/api/tests/profiles": { get: { summary: "List test profiles" } },
      "/api/tests/run": { post: { summary: "Run test profile" } },
      "/api/admin/security": {
        get: {
          summary: "Get admin security settings",
          security: [{ AdminTokenAuth: [] }]
        },
        put: {
          summary: "Update admin security settings",
          security: [{ AdminTokenAuth: [] }]
        }
      }
    }
  };

  return res.json(openapi);
});

app.get("/api/notifications", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 50)));
    const notifications = notificationStore.slice(0, limit);
    await appendAuditLog(req, "notifications-list", { limit, count: notifications.length });
    return res.json({ notifications });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to list notifications") });
  }
});

app.get("/api/files/list", async (req, res) => {
  try {
    const { absolute, rel } = resolveSandboxPath(req.query.path || "");
    const entries = await fsp.readdir(absolute, { withFileTypes: true });
    const mapped = await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(absolute, entry.name);
      const stat = await fsp.stat(entryPath);
      return {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    }));
    mapped.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    await appendAuditLog(req, "list", { path: rel, count: mapped.length });
    return res.json({ path: rel, entries: mapped });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to list directory") });
  }
});

app.get("/api/files/read", async (req, res) => {
  try {
    const { absolute, rel } = resolveSandboxPath(req.query.path || "");
    const stat = await fsp.stat(absolute);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "path is a directory" });
    }
    if (stat.size > maxReadBytes) {
      return res.status(400).json({ error: `file exceeds max read size (${maxReadBytes} bytes)` });
    }

    const content = await fsp.readFile(absolute, "utf8");
    await appendAuditLog(req, "read", { path: rel, size: stat.size });
    return res.json({ path: rel, size: stat.size, content });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to read file") });
  }
});

app.post("/api/files/write", async (req, res) => {
  try {
    const { absolute, rel } = resolveSandboxPath(req.body?.path || "");
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, content, "utf8");
    await commitSandboxSnapshot(`write ${rel || "."}`);
    await appendAuditLog(req, "write", { path: rel, size: Buffer.byteLength(content, "utf8") });
    return res.json({ ok: true, path: rel });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to write file") });
  }
});

app.post("/api/files/upload", (req, res, next) => {
  const requestContext = workspaceContextForCode(req.workspace?.code || defaultWorkspaceCode);
  workspaceContextStore.run(requestContext, () => {
    createUploadMiddlewareForRequest(req)(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          const bypassProvided = Boolean(getUploadBypassCode(req));
          if (bypassProvided && !isUploadLimitBypassAllowed(req)) {
            return res.status(413).json({ error: `unlock code is invalid for workspace '${getWorkspaceContext().code}'` });
          }
          return res.status(413).json({ error: `file exceeds max upload size (${defaultUploadMaxBytes} bytes)` });
        }
        return res.status(400).json({ error: `upload error: ${error.message}` });
      }

      return res.status(400).json({ error: String(error?.message || "Failed to parse upload") });
    });
  });
}, async (req, res) => {
  const requestContext = workspaceContextForCode(req.workspace?.code || defaultWorkspaceCode);
  return workspaceContextStore.run(requestContext, async () => {
    try {
      const uploadedFiles = Array.isArray(req.files) ? req.files : [];
      if (uploadedFiles.length === 0) {
        return res.status(400).json({ error: "missing file upload field 'files' or 'file'" });
      }

      const uploadBase = req.body?.path || "";
      const { rel: relBase } = resolveSandboxPath(uploadBase);
      const relativePaths = toArray(req.body?.relativePaths).map((item) => String(item || ""));
      const saved = [];

      for (let i = 0; i < uploadedFiles.length; i += 1) {
        const file = uploadedFiles[i];
        const requestedRelative = normalizeSandboxRelativePath(relativePaths[i] || file.originalname || "upload.bin");
        const fallbackName = path.basename(file.originalname || "upload.bin");
        const fileRelative = requestedRelative || fallbackName;
        const mergedRelative = normalizeSandboxRelativePath(path.join(relBase, fileRelative));
        const { absolute: targetPath, rel: targetRel } = resolveSandboxPath(mergedRelative);
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.writeFile(targetPath, file.buffer);
        saved.push({ path: targetRel, size: file.size });
      }

      await commitSandboxSnapshot(`upload ${saved.length} file(s)`);
      await appendAuditLog(req, "upload", { base: relBase, count: saved.length, files: saved.map((item) => item.path) });

      if (saved.length === 1) {
        return res.json({ ok: true, workspaceCode: getWorkspaceContext().code, path: saved[0].path, size: saved[0].size, files: saved });
      }

      return res.json({ ok: true, workspaceCode: getWorkspaceContext().code, count: saved.length, files: saved });
    } catch (error) {
      return res.status(400).json({ error: String(error?.message || "Failed to upload file") });
    }
  });
});

app.post("/api/files/upload/chunk/start", async (req, res) => {
  try {
    cleanupExpiredUploadSessions();
    const size = Math.max(0, Number(req.body?.size || 0));
    const basePath = String(req.body?.path || "");
    const requestedRelative = normalizeSandboxRelativePath(req.body?.relativePath || req.body?.name || "upload.bin");
    const fallbackName = path.basename(String(req.body?.name || "upload.bin"));
    const relName = requestedRelative || fallbackName;
    const { rel: relBase } = resolveSandboxPath(basePath);
    const mergedRelative = normalizeSandboxRelativePath(path.join(relBase, relName));
    const { absolute: targetPath, rel: targetRel } = resolveSandboxPath(mergedRelative);

    const bypassAllowed = isUploadLimitBypassAllowed(req);
    if (!bypassAllowed && size > defaultUploadMaxBytes) {
      return res.status(413).json({ error: `file exceeds max upload size (${defaultUploadMaxBytes} bytes)` });
    }

    const uploadRoot = getChunkUploadRoot();
    await fsp.mkdir(uploadRoot, { recursive: true });
    const uploadId = makeUploadSessionId();
    const tempPath = path.join(uploadRoot, `${uploadId}.part`);
    await fsp.writeFile(tempPath, Buffer.alloc(0));

    const totalChunks = Math.max(1, Math.ceil(size / chunkUploadChunkSizeBytes));
    uploadSessionStore.set(uploadId, {
      id: uploadId,
      workspaceCode: getWorkspaceContext().code,
      targetRel,
      targetPath,
      tempPath,
      expectedSize: size,
      totalChunks,
      nextChunkIndex: 0,
      receivedBytes: 0,
      updatedAt: Date.now()
    });

    return res.json({
      ok: true,
      workspaceCode: getWorkspaceContext().code,
      uploadId,
      path: targetRel,
      chunkSizeBytes: chunkUploadChunkSizeBytes,
      totalChunks
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to start chunk upload") });
  }
});

app.post("/api/files/upload/chunk/:uploadId", express.raw({ type: "application/octet-stream", limit: `${Math.max(1, Math.ceil(chunkUploadChunkSizeBytes / (1024 * 1024)) + 2)}mb` }), async (req, res) => {
  try {
    const uploadId = String(req.params.uploadId || "").trim();
    if (!uploadId) {
      return res.status(400).json({ error: "uploadId is required" });
    }

    const chunkIndex = Number(req.query?.index);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ error: "chunk index must be a non-negative integer" });
    }

    const session = getUploadSessionOrThrow(uploadId);
    if (chunkIndex < session.nextChunkIndex) {
      return res.json({
        ok: true,
        duplicate: true,
        workspaceCode: getWorkspaceContext().code,
        uploadId,
        receivedChunks: session.nextChunkIndex,
        totalChunks: session.totalChunks,
        receivedBytes: session.receivedBytes
      });
    }
    if (chunkIndex > session.nextChunkIndex) {
      return res.status(409).json({ error: `expected chunk index ${session.nextChunkIndex}` });
    }

    const chunkBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
    if (!chunkBuffer.length) {
      return res.status(400).json({ error: "chunk body is empty" });
    }

    await fsp.appendFile(session.tempPath, chunkBuffer);
    session.nextChunkIndex += 1;
    session.receivedBytes += chunkBuffer.length;
    session.updatedAt = Date.now();

    return res.json({
      ok: true,
      workspaceCode: getWorkspaceContext().code,
      uploadId,
      receivedChunks: session.nextChunkIndex,
      totalChunks: session.totalChunks,
      receivedBytes: session.receivedBytes
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to upload chunk") });
  }
});

app.get("/api/files/upload/chunk/:uploadId", async (req, res) => {
  try {
    const uploadId = String(req.params.uploadId || "").trim();
    if (!uploadId) {
      return res.status(400).json({ error: "uploadId is required" });
    }

    const session = getUploadSessionOrThrow(uploadId);
    return res.json({
      ok: true,
      workspaceCode: getWorkspaceContext().code,
      uploadId,
      path: session.targetRel,
      expectedSize: session.expectedSize,
      receivedBytes: session.receivedBytes,
      nextChunkIndex: session.nextChunkIndex,
      totalChunks: session.totalChunks,
      done: session.nextChunkIndex >= session.totalChunks
    });
  } catch (error) {
    return res.status(404).json({ error: String(error?.message || "Upload session not found") });
  }
});

app.post("/api/files/upload/chunk/:uploadId/complete", async (req, res) => {
  try {
    const uploadId = String(req.params.uploadId || "").trim();
    if (!uploadId) {
      return res.status(400).json({ error: "uploadId is required" });
    }

    const session = getUploadSessionOrThrow(uploadId);
    if (session.nextChunkIndex !== session.totalChunks) {
      return res.status(409).json({ error: `upload incomplete: ${session.nextChunkIndex}/${session.totalChunks} chunks received` });
    }

    const stat = await fsp.stat(session.tempPath);
    if (session.expectedSize > 0 && stat.size !== session.expectedSize) {
      return res.status(409).json({ error: `upload size mismatch: expected ${session.expectedSize}, got ${stat.size}` });
    }

    await fsp.mkdir(path.dirname(session.targetPath), { recursive: true });
    await fsp.rename(session.tempPath, session.targetPath);
    uploadSessionStore.delete(uploadId);

    await commitSandboxSnapshot(`upload chunked 1 file (${session.targetRel})`);
    await appendAuditLog(req, "upload-chunked", { path: session.targetRel, size: stat.size });

    return res.json({ ok: true, workspaceCode: getWorkspaceContext().code, path: session.targetRel, size: stat.size });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to complete chunk upload") });
  }
});

app.get("/api/files/download", async (req, res) => {
  try {
    const { absolute, rel } = resolveSandboxPath(req.query.path || "");
    const stat = await fsp.stat(absolute);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "path is a directory" });
    }
    await appendAuditLog(req, "download", { path: rel, size: stat.size });
    return res.download(absolute, path.basename(rel || absolute));
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to download file") });
  }
});

app.post("/api/files/move", async (req, res) => {
  try {
    const fromPath = req.body?.fromPath || "";
    const toPath = req.body?.toPath || "";
    const { absolute: fromAbs, rel: fromRel } = resolveSandboxPath(fromPath);
    const { absolute: toAbs, rel: toRel } = resolveSandboxPath(toPath);
    await fsp.mkdir(path.dirname(toAbs), { recursive: true });
    await fsp.rename(fromAbs, toAbs);
    await commitSandboxSnapshot(`move ${fromRel} -> ${toRel}`);
    await appendAuditLog(req, "move", { fromPath: fromRel, toPath: toRel });
    return res.json({ ok: true, fromPath: fromRel, toPath: toRel });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to move path") });
  }
});

app.post("/api/files/rename", async (req, res) => {
  try {
    const currentPath = req.body?.path || "";
    const newName = String(req.body?.newName || "").trim();
    if (!newName || newName.includes("/") || newName.includes("\\")) {
      return res.status(400).json({ error: "newName must be a file or folder name" });
    }
    const { absolute: currentAbs, rel: currentRel } = resolveSandboxPath(currentPath);
    const toAbs = path.join(path.dirname(currentAbs), newName);
    const toRel = normalizeSandboxRelativePath(path.join(path.dirname(currentRel), newName));
    await fsp.rename(currentAbs, toAbs);
    await commitSandboxSnapshot(`rename ${currentRel} -> ${toRel}`);
    await appendAuditLog(req, "rename", { fromPath: currentRel, toPath: toRel });
    return res.json({ ok: true, path: toRel });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to rename path") });
  }
});

app.delete("/api/files/delete", async (req, res) => {
  try {
    const { absolute, rel } = resolveSandboxPath(req.query.path || "");
    if (!rel) {
      return res.status(400).json({ error: "refusing to delete sandbox root" });
    }
    await fsp.rm(absolute, { recursive: true, force: true });
    await commitSandboxSnapshot(`delete ${rel}`);
    await appendAuditLog(req, "delete", { path: rel });
    return res.json({ ok: true, path: rel });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to delete path") });
  }
});

app.post("/api/files/mkdir", async (req, res) => {
  try {
    const { absolute, rel } = resolveSandboxPath(req.body?.path || "");
    await fsp.mkdir(absolute, { recursive: true });
    await commitSandboxSnapshot(`mkdir ${rel || "."}`);
    await appendAuditLog(req, "mkdir", { path: rel || "." });
    return res.json({ ok: true, path: rel });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to create directory") });
  }
});

app.post("/api/files/format", async (req, res) => {
  try {
    const targetPath = String(req.body?.path || "");
    let content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!content) {
      const { absolute } = resolveSandboxPath(targetPath);
      content = await fsp.readFile(absolute, "utf8");
    }

    const formatResult = await formatTextFile(targetPath, content);
    const parser = String(formatResult?.parser || "unknown");
    const formatted = String(formatResult?.formatted || "");
    const shouldWrite = Boolean(req.body?.write);
    if (shouldWrite) {
      const { absolute, rel } = resolveSandboxPath(targetPath);
      await fsp.mkdir(path.dirname(absolute), { recursive: true });
      await fsp.writeFile(absolute, formatted, "utf8");
      await commitSandboxSnapshot(`format ${rel}`);
      await appendAuditLog(req, "format", { path: rel, parser, write: true });
    } else {
      await appendAuditLog(req, "format", { path: targetPath, parser, write: false });
    }

    return res.json({ ok: true, parser, formatted });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to format file") });
  }
});

app.post("/api/files/lint", async (req, res) => {
  try {
    const targetPath = String(req.body?.path || "").trim();
    if (!targetPath) {
      return res.status(400).json({ error: "path is required" });
    }

    let content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!content) {
      const { absolute } = resolveSandboxPath(targetPath);
      content = await fsp.readFile(absolute, "utf8");
    }

    const lintResult = await lintTextFile(targetPath, content);
    const messages = Array.isArray(lintResult?.messages) ? lintResult.messages : [];

    await appendAuditLog(req, "lint", { path: targetPath, issueCount: messages.length });
    return res.json({
      ok: true,
      path: targetPath,
      issueCount: messages.length,
      messages
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to lint file") });
  }
});

app.post("/api/files/terminal", async (req, res) => {
  try {
    const result = await runSafeTerminalCommand(
      req.body?.command,
      req.body?.args,
      req.body?.cwd,
      req.body?.timeoutMs
    );

    await appendAuditLog(req, "terminal", {
      command: result.command,
      cwd: result.cwd,
      ok: result.ok,
      code: result.code || 0
    });

    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to run terminal command") });
  }
});

app.get("/api/files/audit", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(1000, Number(req.query.limit || 200)));
    const before = String(req.query.before || "").trim();
    const operationFilter = String(req.query.operation || "").trim().toLowerCase();
    const toolNameFilter = String(req.query.tool || "").trim();
    const traceIdFilter = String(req.query.traceId || req.query.trace || "").trim();
    const onlyErrors = String(req.query.onlyErrors || "").trim().toLowerCase() === "true";
    const pageSize = Math.max(limit * 4, 400);
    const batch = await readAuditEntries({ limit: pageSize, before, returnMeta: true });
    const filtered = batch.entries
      .filter((entry) => {
        if (operationFilter && String(entry?.operation || "").toLowerCase() !== operationFilter) {
          return false;
        }
        if (toolNameFilter && String(entry?.details?.name || "") !== toolNameFilter) {
          return false;
        }
        if (traceIdFilter && String(entry?.traceId || "") !== traceIdFilter) {
          return false;
        }
        if (onlyErrors) {
          const op = String(entry?.operation || "");
          const okFlag = entry?.details?.ok;
          const isErrorRecord = op === "agent-tool-error" || okFlag === false || String(okFlag).toLowerCase() === "false";
          if (!isErrorRecord) {
            return false;
          }
        }
        return true;
      })
      .slice(0, limit);

    const hasMore = batch.hasMore || (batch.entries.length > filtered.length);
    const nextBefore = filtered.length > 0 ? String(filtered[filtered.length - 1]?.timestamp || "") || null : null;

    return res.json({
      entries: filtered,
      paging: {
        limit,
        before: before || null,
        hasMore,
        nextBefore
      },
      filters: {
        operation: operationFilter || null,
        tool: toolNameFilter || null,
        traceId: traceIdFilter || null,
        onlyErrors
      }
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to read audit log") });
  }
});

app.get("/api/files/git/log", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const { stdout } = await runGit([
      "log",
      `-n${limit}`,
      "--pretty=format:%H%x09%h%x09%ad%x09%s",
      "--date=iso"
    ], true);

    const commits = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, date, ...subjectParts] = line.split("\t");
        return {
          hash,
          shortHash,
          date,
          subject: subjectParts.join("\t")
        };
      });

    await appendAuditLog(req, "git-log", { limit, count: commits.length });
    return res.json({ commits });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to read git log") });
  }
});

app.post("/api/files/git/revert", async (req, res) => {
  try {
    const ref = String(req.body?.ref || "").trim() || "HEAD~1";
    await runGit(["reset", "--hard", ref]);
    await runGit(["clean", "-fd"]);
    await commitSandboxSnapshot(`revert baseline ${ref}`);
    await appendAuditLog(req, "git-revert", { ref });
    return res.json({ ok: true, ref });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to revert sandbox") });
  }
});

app.get("/api/files/snapshots", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit || 30)));
    const snapshots = await listGitSnapshots(limit);
    await appendAuditLog(req, "snapshots-list", { limit, count: snapshots.length });
    return res.json({ snapshots });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to list snapshots") });
  }
});

app.post("/api/files/snapshots", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const snapshot = await createManualSnapshot(message);
    await appendAuditLog(req, "snapshot-create", { message: message || null, hash: snapshot?.hash || null });
    return res.json({ ok: true, snapshot });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to create snapshot") });
  }
});

app.post("/api/files/snapshots/restore", async (req, res) => {
  try {
    const ref = String(req.body?.ref || "").trim() || "HEAD~1";
    const result = await restoreSnapshot(ref);
    await appendAuditLog(req, "snapshot-restore", { ref });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to restore snapshot") });
  }
});

app.get("/api/files/diff", async (req, res) => {
  try {
    const left = String(req.query.left || "HEAD~1");
    const right = String(req.query.right || "HEAD");
    const targetPath = String(req.query.path || "");
    const result = await getGitDiffBetweenRefs(left, right, targetPath);
    await appendAuditLog(req, "diff-refs", { left: result.left, right: result.right, path: result.path });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to diff refs") });
  }
});

app.post("/api/files/diff/paths", async (req, res) => {
  try {
    const leftPath = String(req.body?.leftPath || "").trim();
    const rightPath = String(req.body?.rightPath || "").trim();
    if (!leftPath || !rightPath) {
      return res.status(400).json({ error: "leftPath and rightPath are required" });
    }
    const result = await getPathDiffNoIndex(leftPath, rightPath);
    await appendAuditLog(req, "diff-paths", { leftPath: result.leftPath, rightPath: result.rightPath });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to diff paths") });
  }
});

app.post("/api/files/merge/from-snapshot", async (req, res) => {
  try {
    const ref = String(req.body?.ref || "").trim();
    const targetPath = String(req.body?.path || "").trim();
    const result = await mergePathFromSnapshot(ref, targetPath);
    await appendAuditLog(req, "merge-from-snapshot", { ref: result.ref, path: result.path });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to merge from snapshot") });
  }
});

app.get("/api/files/search", async (req, res) => {
  try {
    const query = String(req.query.q || req.query.query || "").trim();
    const mode = String(req.query.mode || "hybrid").trim();
    const targetPath = String(req.query.path || "").trim();
    const limit = Number(req.query.limit || 20);
    const result = await searchSandboxContent({ query, mode, path: targetPath, limit });
    await appendAuditLog(req, "search", {
      query: result.query,
      mode: result.mode,
      path: result.path,
      filesScanned: result.filesScanned,
      resultCount: result.resultCount
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to search sandbox") });
  }
});

app.get("/api/tests/profiles", (_req, res) => {
  return res.json({
    profiles: [
      {
        profile: "npm-test",
        command: "npm test",
        description: "Run project npm test script",
        supportedCwd: ["project", "sandbox"]
      },
      {
        profile: "npm-lint",
        command: "npm run lint",
        description: "Run lint script if configured",
        supportedCwd: ["project", "sandbox"]
      },
      {
        profile: "node-test",
        command: "node --test",
        description: "Run Node built-in test runner",
        supportedCwd: ["project", "sandbox"]
      },
      {
        profile: "chat-jobs-smoke",
        command: "node --test tests/chat-jobs.test.mjs",
        description: "Validate async chat job create/poll/cancel flow",
        supportedCwd: ["project"]
      }
    ]
  });
});

app.post("/api/tests/run", async (req, res) => {
  try {
    const result = await runAutomatedTestProfile({
      profile: req.body?.profile,
      timeoutMs: req.body?.timeoutMs,
      cwd: req.body?.cwd
    });
    await appendAuditLog(req, "tests-run", {
      profile: result.profile,
      cwd: result.cwd,
      exitCode: result.exitCode,
      ok: result.ok,
      failureCount: result.failures.length
    });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to run tests") });
  }
});

app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

await ensureSandboxReady();
await loadAdminSecuritySettings();
scheduleNightlyWorkspaceBackups();

app.listen(port, () => {
  console.log(`Remote AI Access running at ${appBaseUrl}`);
});
