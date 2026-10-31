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
import net from "net";
import { promisify } from "util";
import { execFile, spawn } from "child_process";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { pipeline } from "stream/promises";
import { resolveProviderMessageContext } from "./chat-context.js";
import { buildBoundedAgentConversation, serializeBoundedToolOutput } from "./compatible-agent-context.js";
import {
  agentToolPolicySummary,
  filterAgentToolDefinitions,
  isAgentToolAllowed,
  normalizeAgentToolProfile
} from "./agent-policy.js";
import {
  compareQueuedChatJobs,
  normalizeChatJobPriority,
  orderedQueuedChatJobs,
  selectDispatchableChatJobs
} from "./chat-job-queue.js";
import {
  readChatJobState,
  restoreChatJobState,
  serializeChatJobState,
  writeChatJobState
} from "./chat-job-persistence.js";
import {
  isRetryableProviderStatus,
  providerRetryDelayMs
} from "./provider-retry.js";
import {
  firstConfiguredEnv,
  isValidProviderModelName,
  parseProviderModelList,
  resolveProviderApiKey,
  resolveProviderModel,
  selectDefaultProvider
} from "./provider-config.js";
import {
  calculateNextRunAt,
  normalizeAgentRecipeSchedule
} from "./agent-recipe-schedule.js";
import {
  isSubagentWritePathAllowed,
  normalizeSubagentAllowedPaths,
  normalizeSubagentLimits,
  normalizeSubagentRole,
  resolveSubagentAllowedTools,
  SUBAGENT_LIMITS
} from "./subagent-policy.js";
import { previewDeployment } from "./deployment-policy.js";
import {
  beginDeploymentActivation,
  completeDeploymentActivation,
  createDeploymentApproval,
  failDeploymentActivation,
  publicDeploymentApproval,
  revokeDeploymentApproval
} from "./deployment-approval.js";
import { makeReleaseId } from "./deployment-helper-policy.js";
import { summarizeDirectoryContents } from "./directory-summary.js";
import {
  BASIC_AUTH_SESSION_COOKIE,
  createBasicAuthSession,
  normalizeBasicAuthReturnPath,
  verifyBasicAuthSession
} from "./basic-auth-session.js";
import {
  CHAT_ARCHIVE_FORMAT,
  normalizeStoredArchivePayload,
  readStoredArchive,
  writeStoredArchive
} from "./chat-archive-store.js";
import {
  extendShareExpiration,
  publicShareAnalytics,
  recordShareActivity
} from "./share-analytics.js";
import { buildAutomaticGitAddArgs, isManagedGitPath, isNothingToCommit, normalizeGitChangePaths, parseGitStatusPorcelain } from "./git-change-center.js";
import { appendMetricSample, calculateCpuPercent, summarizeRuntimeSample } from "./runtime-monitor.js";
import { addTokenUsage, aggregateUsage, estimateUsageCost, normalizeTokenUsage } from "./usage-ledger.js";
import {
  applyWorkspaceReplacements,
  previewWorkspaceReplacements,
  searchWorkspaceFiles
} from "./workspace-search.js";
import { matchesUnlockCode, parseWorkspaceUnlockCodes } from "./workspace-unlock-codes.js";
import { extractGeneratedImage, normalizeImageRequest, parseWikimediaImageResults } from "./image-tools.js";
import { buildWorkspaceActivityTimeline } from "./workspace-activity.js";
import { buildCodeMap, codeMapSummary } from "./code-map.js";
import { collectSubagentArtifacts, extractSubagentContextProposals, mergeSubagentAcceptance } from "./subagent-results.js";
import { createReviewWorkflow, recordReviewStage } from "./review-workflow.js";
import { runTddRepairLoop } from "./tdd-runner.js";
import { approveTddCommit } from "./tdd-workflow.js";
import {
  managedToolContainerIds,
  MANAGED_TOOL_CONTAINER_CONFIRMATION,
  MANAGED_TOOL_CONTAINER_LABEL,
  parseManagedToolContainers
} from "./managed-tool-containers.js";

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
const workspaceGitHttpsBaseUrl = String(process.env.WORKSPACE_GIT_HTTPS_BASE_URL || "").trim().replace(/\/+$/, "");
const defaultUploadMaxBytes = Math.max(1024, Number(process.env.FILE_API_UPLOAD_MAX_BYTES || 20 * 1024 * 1024));
const workspaceUploadBypassCodesRaw = String(process.env.WORKSPACE_UPLOAD_BYPASS_CODES || "");
const workspaceUploadBypassCodes = parseWorkspaceUploadBypassCodes(workspaceUploadBypassCodesRaw);
const workspaceAgentStepOverrideCodesRaw = String(process.env.WORKSPACE_AGENT_STEP_OVERRIDE_CODES || "");
const chunkUploadThresholdBytes = Math.max(1024 * 1024, Number(process.env.FILE_API_CHUNK_UPLOAD_THRESHOLD_BYTES || 64 * 1024 * 1024));
const chunkUploadChunkSizeBytes = Math.max(256 * 1024, Number(process.env.FILE_API_CHUNK_SIZE_BYTES || 4 * 1024 * 1024));
const chunkUploadMaxChunkSizeBytes = Math.max(chunkUploadChunkSizeBytes, Number(process.env.FILE_API_MAX_CHUNK_SIZE_BYTES || 64 * 1024 * 1024));
const chunkUploadSessionMaxAgeMs = Math.max(60_000, Number(process.env.FILE_API_CHUNK_SESSION_MAX_AGE_MS || 2 * 60 * 60 * 1000));
const fileShareDbPath = path.resolve(process.env.FILE_SHARE_DB_PATH || path.join(sandboxBaseRoot, "_admin", "file-shares.json"));
const fileShareDataRoot = path.resolve(process.env.FILE_SHARE_DATA_ROOT || path.join(sandboxBaseRoot, "_admin", "file-share-data"));
const fileShareEncryptionSecret = String(process.env.FILE_SHARE_ENCRYPTION_SECRET || "");
const videoPreviewTranscodeTimeoutMs = Math.max(60_000, Number(process.env.VIDEO_PREVIEW_TRANSCODE_TIMEOUT_MS || 2 * 60 * 60 * 1000));
const agentRecipeScheduleDbPath = path.resolve(process.env.AGENT_RECIPE_SCHEDULE_DB_PATH || path.join(sandboxBaseRoot, "_admin", "agent-recipe-schedules.json"));
const chatJobDbPath = path.resolve(process.env.CHAT_JOB_DB_PATH || path.join(sandboxBaseRoot, "_admin", "chat-jobs.json"));
const chatArchiveRoot = path.resolve(process.env.CHAT_ARCHIVE_ROOT || path.join(sandboxBaseRoot, "_admin", "chat-archives"));
const chatArchiveMaxBytes = Math.max(256 * 1024, Math.min(25 * 1024 * 1024, Number(process.env.CHAT_ARCHIVE_MAX_BYTES || 20 * 1024 * 1024)));
const usageLedgerPath = path.resolve(process.env.USAGE_LEDGER_PATH || path.join(sandboxBaseRoot, "_admin", "usage.jsonl"));
const usagePricing = (() => { try { return JSON.parse(process.env.USAGE_PRICING_JSON || "{}"); } catch { return {}; } })();
const usageMonthlyWarningTokens = Math.max(0, Number(process.env.USAGE_MONTHLY_WARNING_TOKENS || 0));
const usageMonthlyHardLimitTokens = Math.max(0, Number(process.env.USAGE_MONTHLY_HARD_LIMIT_TOKENS || 0));
const usageMonthlyWarningUsd = Math.max(0, Number(process.env.USAGE_MONTHLY_WARNING_USD || 0));
const usageMonthlyHardLimitUsd = Math.max(0, Number(process.env.USAGE_MONTHLY_HARD_LIMIT_USD || 0));
const deploymentAllowedSuffixes = String(process.env.DEPLOYMENT_ALLOWED_SUFFIXES || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const deploymentAllowedRuntimes = String(process.env.DEPLOYMENT_ALLOWED_RUNTIMES || "static,node-service")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const deploymentAllowedEnvironmentNames = String(process.env.DEPLOYMENT_ALLOWED_ENV_NAMES || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const deploymentPreviewPort = Math.max(1024, Math.min(65535, Number(process.env.DEPLOYMENT_PREVIEW_PORT || 8900)));
const deploymentApprovalDbPath = path.resolve(process.env.DEPLOYMENT_APPROVAL_DB_PATH || path.join(sandboxBaseRoot, "_admin", "deployment-approvals.json"));
const deploymentHelperSocketPath = String(process.env.DEPLOYMENT_HELPER_SOCKET_PATH || "/run/raa-deploy/helper.sock").trim();
const deploymentHelperTimeoutMs = Math.max(5_000, Math.min(120_000, Number(process.env.DEPLOYMENT_HELPER_TIMEOUT_MS || 30_000)));

const execFileAsync = promisify(execFile);
const safeTerminalCommands = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "bun",
  "python", "python3", "pip", "pip3", "pytest", "virtualenv",
  "git", "make", "cmake", "ctest", "cpack", "ccmake", "ninja", "gcc", "g++", "cc", "c++", "clang", "clang++", "go", "cargo", "rustc",
  "php", "composer", "ruby", "bundle", "java", "javac", "mvn", "gradle",
  "cd", "ls", "dir", "pwd", "echo", "cat", "type", "grep", "rg", "find", "head", "tail", "wc",
  "sed", "awk", "sort", "uniq", "cut", "tr", "xargs", "stat", "du", "df", "file",
  "date", "whoami", "id", "uname", "which", "where", "tree", "env", "printenv",
  "mkdir", "touch", "cp", "mv", "rm", "rmdir", "chmod",
  "basename", "dirname", "realpath", "readlink", "tee", "cmp", "diff", "patch",
  "tar", "zip", "unzip", "7z", "7za", "7zr", "vfa"
]);
const dockerOnlyTerminalCommands = new Set(["sh", "bash", "dash", "apt", "apt-get", "dpkg", "dpkg-query", "curl", "wget", "jq", "ctags", "gdb", "lldb", "strace", "ldd", "ldconfig"]);
const blockedTerminalCommandsAlways = new Set(["sudo", "su", "systemctl", "service", "docker", "podman", "mount", "umount", "chown"]);
const blockedTerminalCommandsHostOnly = new Set(["apt", "apt-get", "dnf", "yum", "apk", "pacman"]);
const blockedTerminalArgPatterns = [/^--prefix=/i, /^--root=/i, /^--target=/i];
const allowedDockerAbsolutePathPrefixes = ["/bin", "/sbin", "/usr/bin", "/usr/sbin", "/usr/local/bin", "/usr/local/sbin", "/lib", "/lib64", "/usr/lib", "/usr/lib64", "/etc/apt", "/var/lib/apt", "/var/cache/apt", "/tmp", "/workspace"];
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
const pausedChatJobWorkspaces = new Set();
const agentRecipeScheduleStore = new Map();
const subagentJobStore = new Map();
const runtimeMetricHistory = new Map();
const providerLatencyHistory = new Map();
let previousHostCpuSnapshot = null;
let scheduledTaskCounter = 0;
let chatJobCounter = 0;
let subagentJobCounter = 0;
const workspaceContextStore = new AsyncLocalStorage();
const workspaceReadyPromises = new Map();
const workspaceBranchState = new Map();
const workspaceGitQueues = new Map();
const terminalRuntime = String(process.env.TERMINAL_RUNTIME || "host").trim().toLowerCase() === "docker" ? "docker" : "host";
const terminalDockerImage = String(process.env.TERMINAL_DOCKER_IMAGE || "node:20-bookworm").trim() || "node:20-bookworm";
const terminalDockerMemory = String(process.env.TERMINAL_DOCKER_MEMORY || "1g").trim() || "1g";
const terminalDockerCpus = String(process.env.TERMINAL_DOCKER_CPUS || "1.0").trim() || "1.0";
const terminalDockerPidsLimit = Math.max(64, Math.min(2048, Number(process.env.TERMINAL_DOCKER_PIDS_LIMIT || 256)));
const terminalDockerNetwork = String(process.env.TERMINAL_DOCKER_NETWORK || "bridge").trim() || "bridge";
const terminalDockerShellCommandLines = String(process.env.TERMINAL_DOCKER_SHELL_COMMAND_LINES || "true").trim().toLowerCase() !== "false";
const defaultTerminalDockerAllowedImages = [
  terminalDockerImage,
  "alpine:latest",
  "archlinux:latest",
  "debian:bookworm-slim",
  "fedora:latest",
  "golang:alpine",
  "golang:bookworm",
  "kalilinux/kali-rolling",
  "kalilinux/kali-last-release",
  "node:20-bookworm",
  "node:20",
  "python:3-bookworm",
  "python:3-slim-bookworm",
  "rust:bookworm",
  "rust:slim-bookworm",
  "ubuntu:24.04",
  "emscripten/emsdk",
  "parrotsec/core",
  "parrotsec/security",
  "blackarchlinux/blackarch",
  "ghcr.io/webassembly/wasi-sdk",
  "quay.io/pypa/manylinux_2_28_x86_64",
  "quay.io/pypa/manylinux_2_28_aarch64",
  "quay.io/pypa/musllinux_1_2_x86_64",
  "quay.io/pypa/musllinux_1_2_aarch64",
  "dockcross/android-arm64",
  "dockcross/android-x86_64",
  "dockcross/linux-x64",
  "dockcross/linux-x64-clang",
  "dockcross/linux-arm64",
  "dockcross/linux-armv7",
  "dockcross/linux-armv7l",
  "dockcross/linux-i686",
  "dockcross/linux-ppc64le",
  "dockcross/linux-riscv64",
  "dockcross/linux-s390x",
  "dockcross/web-wasm",
  "dockcross/web-wasi",
  "dockcross/web-wasi-threads",
  "dockcross/windows-arm64",
  "dockcross/windows-static-x64",
  "dockcross/windows-static-x64-posix",
  "dockcross/windows-shared-x64",
  "dockcross/windows-shared-x64-posix",
  "dockcross/windows-static-x86",
  "dockcross/windows-shared-x86",
  "dockcross/manylinux_2_28-x64",
  "messense/rust-musl-cross:x86_64-musl",
  "mstorsjo/llvm-mingw",
  "silkeh/clang:18",
  "llvm/llvm:18",
  "mcr.microsoft.com/dotnet/sdk:8.0",
  "osxcross",
  "valgrind"
];
const terminalDockerAllowedImages = new Set(
  [
    ...defaultTerminalDockerAllowedImages,
    ...String(process.env.TERMINAL_DOCKER_ALLOWED_IMAGES || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ].filter((item) => isValidDockerImageName(item))
);
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
let fileShareWriteQueue = Promise.resolve();
let deploymentApprovalWriteQueue = Promise.resolve();
let deploymentApprovalMutationQueue = Promise.resolve();
let deploymentActivationQueue = Promise.resolve();
let usageLedgerWriteQueue = Promise.resolve();
let chatJobPersistenceWriteQueue = Promise.resolve();
let chatJobPersistenceTimer = null;

const port = Number(process.env.PORT || 8787);
const host = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
const configuredAppBaseUrl = String(process.env.APP_BASE_URL || "").trim().replace(/\/+$/, "");
const appBaseUrl = configuredAppBaseUrl || `http://localhost:${port}`;
const apiRateLimitWindowMs = Math.max(1000, Math.min(60 * 60 * 1000, Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000)));
const apiRateLimitMax = Math.max(1, Math.min(200000, Number(process.env.API_RATE_LIMIT_MAX || 3000)));
const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1";
const xaiDefaultModel = process.env.XAI_MODEL || "grok-4.6";
const googleDefaultModel = process.env.GOOGLE_MODEL || "gemini-3.7-flash";
const agentMaxStepsHardLimit = Math.max(16, Math.min(4096, Number(process.env.AGENT_MAX_STEPS_HARD_LIMIT || 1024)));
const agentMaxSteps = Math.max(1, Math.min(agentMaxStepsHardLimit, Number(process.env.AGENT_MAX_STEPS || 16)));
const agentMaxStepsOverrideLimit = Math.max(agentMaxSteps, Math.min(agentMaxStepsHardLimit, Number(process.env.AGENT_MAX_STEPS_OVERRIDE_LIMIT || 40)));
const agentMaxStepsOverrideCode = String(process.env.AGENT_MAX_STEPS_OVERRIDE_CODE || "").trim();
const agentWebTimeoutMs = Math.max(1000, Math.min(40000, Number(process.env.AGENT_WEB_TIMEOUT_MS || 16000)));
const providerRequestTimeoutMs = Math.max(30_000, Math.min(2 * 60 * 60 * 1000, Number(process.env.PROVIDER_REQUEST_TIMEOUT_MS || 30 * 60 * 1000)));
const providerMaxRetries = Math.max(0, Math.min(10, Number(process.env.PROVIDER_MAX_RETRIES || 5)));
const providerRetryBaseMs = Math.max(100, Math.min(30_000, Number(process.env.PROVIDER_RETRY_BASE_MS || 1000)));
const providerRetryMaxMs = Math.max(providerRetryBaseMs, Math.min(5 * 60 * 1000, Number(process.env.PROVIDER_RETRY_MAX_MS || 60_000)));
const agentReachHome = path.resolve(process.env.AGENT_REACH_HOME || "/var/lib/remote-ai-access");
const agentReachBin = path.resolve(process.env.AGENT_REACH_BIN || "/opt/agent-reach/venv/bin/agent-reach");
const agentReachMcporterBin = path.resolve(process.env.AGENT_REACH_MCPORTER_BIN || "/opt/agent-reach/npm/bin/mcporter");
const agentReachYtDlpBin = path.resolve(process.env.AGENT_REACH_YTDLP_BIN || "/opt/agent-reach/venv/bin/yt-dlp");
const agentReachTimeoutMs = Math.max(5000, Math.min(120000, Number(process.env.AGENT_REACH_TIMEOUT_MS || 45000)));
const agentReachProxy = String(process.env.AGENT_REACH_PROXY || "").trim();
const agentReachYoutubeCookiesFile = String(process.env.AGENT_REACH_YOUTUBE_COOKIES_FILE || "").trim();
const chatMessageMaxChars = Math.max(1000, Math.min(20000, Number(process.env.CHAT_MESSAGE_MAX_CHARS || 8000)));
const chatContextMaxChars = Math.max(chatMessageMaxChars, Math.min(200000, Number(process.env.CHAT_CONTEXT_MAX_CHARS || 32000)));
const chatCompactionSummaryMaxChars = Math.max(1000, Math.min(chatContextMaxChars, Number(process.env.CHAT_COMPACTION_SUMMARY_MAX_CHARS || 6000)));
const compatibleAgentContextMaxChars = Math.max(chatContextMaxChars, Math.min(200000, Number(process.env.COMPATIBLE_AGENT_CONTEXT_MAX_CHARS || 64000)));
const compatibleAgentToolOutputMaxChars = Math.max(500, Math.min(20000, Number(process.env.COMPATIBLE_AGENT_TOOL_OUTPUT_MAX_CHARS || 4000)));
const chatJobMaxAgeMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(process.env.CHAT_JOB_MAX_AGE_MS || 6 * 60 * 60 * 1000)));
const chatJobMaxEntries = Math.max(20, Math.min(2000, Number(process.env.CHAT_JOB_MAX_ENTRIES || 300)));
const chatJobEventHistoryMax = Math.max(20, Math.min(4000, Number(process.env.CHAT_JOB_EVENT_HISTORY_MAX || 240)));
const chatJobMaxConcurrent = Math.max(1, Math.min(12, Number(process.env.CHAT_JOB_MAX_CONCURRENT || 2)));
const chatJobDefaultWorkspaceConcurrent = Math.max(1, Math.min(chatJobMaxConcurrent, Number(process.env.CHAT_JOB_DEFAULT_WORKSPACE_CONCURRENT || chatJobMaxConcurrent)));
const chatJobWorkspaceConcurrency = (() => {
  try {
    const parsed = JSON.parse(process.env.CHAT_JOB_WORKSPACE_CONCURRENCY_JSON || "{}");
    return new Map(Object.entries(parsed).map(([code, limit]) => [
      normalizeWorkspaceCode(code),
      Math.max(1, Math.min(chatJobMaxConcurrent, Number(limit || chatJobDefaultWorkspaceConcurrent)))
    ]).filter(([code]) => code));
  } catch {
    return new Map();
  }
})();
const runtimeMetricHistoryLimit = Math.max(10, Math.min(1440, Number(process.env.RUNTIME_METRIC_HISTORY_LIMIT || 180)));
const auditLogMaxBytes = Math.max(128 * 1024, Math.min(64 * 1024 * 1024, Number(process.env.AUDIT_LOG_MAX_BYTES || 8 * 1024 * 1024)));
const auditRetentionDays = Math.max(1, Math.min(365, Number(process.env.AUDIT_RETENTION_DAYS || 14)));
const auditRetentionPruneIntervalMs = Math.max(30_000, Math.min(60 * 60 * 1000, Number(process.env.AUDIT_RETENTION_PRUNE_INTERVAL_MS || 5 * 60 * 1000)));
const githubPat = String(process.env.GITHUB_PAT || process.env.GITHUB_TOKEN || "").trim();
const xaiApiKey = String(process.env.XAI_API_KEY || "").trim();
const xaiApiBaseUrl = String(process.env.XAI_API_BASE_URL || "https://api.x.ai/v1").trim().replace(/\/+$/, "");
const googleApiKey = String(process.env.GOOGLE_API_KEY || "").trim();
const googleApiBaseUrl = String(process.env.GOOGLE_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").trim().replace(/\/+$/, "");
const deepseekApiKey = resolveProviderApiKey("deepseek");
const deepseekApiBaseUrl = firstConfiguredEnv(process.env, ["DEEPSEEK_API_BASE_URL"], "https://api.deepseek.com").replace(/\/+$/, "");
const deepseekDefaultModel = firstConfiguredEnv(process.env, ["DEEPSEEK_MODEL"], "deepseek-v4-flash");
const anthropicApiKey = resolveProviderApiKey("anthropic");
const anthropicApiBaseUrl = firstConfiguredEnv(process.env, ["ANTHROPIC_API_BASE_URL", "ANTHROPIC_CLAUDE_API_BASE_URL"], "https://api.anthropic.com/v1").replace(/\/+$/, "");
const anthropicDefaultModel = firstConfiguredEnv(process.env, ["ANTHROPIC_MODEL", "ANTHROPIC_CLAUDE_MODEL"], "claude-sonnet-5");
const anthropicVersion = String(process.env.ANTHROPIC_VERSION || "2023-06-01").trim();
const anthropicMaxTokens = Math.max(1, Math.min(64_000, Number(process.env.ANTHROPIC_MAX_TOKENS || 4096)));
const togetherApiKey = resolveProviderApiKey("together");
const togetherApiBaseUrl = firstConfiguredEnv(process.env, ["TOGETHER_API_BASE_URL", "TOGETHER_AI_API_BASE_URL"], "https://api.together.ai/v1").replace(/\/+$/, "");
const togetherDefaultModel = firstConfiguredEnv(process.env, ["TOGETHER_MODEL", "TOGETHER_AI_MODEL"], "meta-llama/Llama-3.3-70B-Instruct-Turbo");
const openRouterApiKey = resolveProviderApiKey("openrouter");
const openRouterApiBaseUrl = firstConfiguredEnv(process.env, ["OPENROUTER_API_BASE_URL", "OPEN_ROUTER_API_BASE_URL"], "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const openRouterDefaultModel = firstConfiguredEnv(process.env, ["OPENROUTER_MODEL", "OPEN_ROUTER_MODEL"], "anthropic/claude-sonnet-5");
const openRouterHttpReferer = String(process.env.OPENROUTER_HTTP_REFERER || configuredAppBaseUrl || "").trim();
const openRouterTitle = String(process.env.OPENROUTER_TITLE || "Remote AI Access").trim();
const openaiImageModel = String(process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
const xaiImageModel = String(process.env.XAI_IMAGE_MODEL || "grok-imagine-image").trim();
const googleImageModel = String(process.env.GOOGLE_IMAGE_MODEL || "gemini-2.5-flash-image").trim();
const googleNativeApiBaseUrl = String(process.env.GOOGLE_NATIVE_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").trim().replace(/\/+$/, "");
const copilotApiBaseUrl = String(process.env.COPILOT_API_BASE_URL || "https://models.github.ai/inference").trim();
const copilotApiVersion = firstConfiguredEnv(process.env, ["COPILOT_API_VERSION", "GITHUB_API_VERSION"], "2026-03-10");
const copilotDefaultModel = firstConfiguredEnv(process.env, ["COPILOT_MODEL"], "openai/gpt-4.1");
const allowedModels = String(process.env.OPENAI_ALLOWED_MODELS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const xaiAllowedModels = String(process.env.XAI_ALLOWED_MODELS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const googleAllowedModels = String(process.env.GOOGLE_ALLOWED_MODELS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const copilotAllowedModels = parseProviderModelList(process.env.COPILOT_ALLOWED_MODELS);
const deepseekAllowedModels = parseProviderModelList(process.env.DEEPSEEK_ALLOWED_MODELS);
const anthropicAllowedModels = parseProviderModelList(firstConfiguredEnv(process.env, ["ANTHROPIC_ALLOWED_MODELS", "ANTHROPIC_CLAUDE_ALLOWED_MODELS"]));
const togetherAllowedModels = parseProviderModelList(firstConfiguredEnv(process.env, ["TOGETHER_ALLOWED_MODELS", "TOGETHER_AI_ALLOWED_MODELS"]));
const openRouterAllowedModels = parseProviderModelList(firstConfiguredEnv(process.env, ["OPENROUTER_ALLOWED_MODELS", "OPEN_ROUTER_ALLOWED_MODELS"]));
const deepseekAgentModels = parseProviderModelList(firstConfiguredEnv(process.env, ["DEEPSEEK_AGENT_MODELS"], deepseekDefaultModel));
const togetherAgentModels = parseProviderModelList(firstConfiguredEnv(process.env, ["TOGETHER_AGENT_MODELS", "TOGETHER_AI_AGENT_MODELS"], togetherDefaultModel));
const openRouterAgentModels = parseProviderModelList(firstConfiguredEnv(process.env, ["OPENROUTER_AGENT_MODELS", "OPEN_ROUTER_AGENT_MODELS"], openRouterDefaultModel));

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
const browserFileSessionCookieName = "raa_file_session";
const browserFileSessionTtlMs = 2 * 60 * 60 * 1000;
const browserFileSessions = new Map();
const videoPreviewCacheRoot = path.join(os.tmpdir(), "remote-ai-video-preview-cache");
const videoPreviewJobs = new Map();
const imagePreviewCacheRoot = path.join(os.tmpdir(), "remote-ai-image-preview-cache");
const imagePreviewJobs = new Map();
const codeMapCache = new Map();
const adminDashboardToken = String(process.env.ADMIN_DASHBOARD_TOKEN || "").trim();
const adminSettingsDbPath = path.resolve(process.env.ADMIN_SETTINGS_DB_PATH || path.join(sandboxBaseRoot, "_admin", "settings-db.json"));
let adminSettingsCache = null;
let adminSettingsLoaded = false;

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey && !xaiApiKey && !googleApiKey && !githubPat && !deepseekApiKey && !anthropicApiKey && !togetherApiKey && !openRouterApiKey) {
  console.error("Missing provider credentials. Set at least one supported provider API key.");
  process.exit(1);
}

const client = openaiApiKey ? new OpenAI({
  apiKey: openaiApiKey,
  timeout: providerRequestTimeoutMs,
  maxRetries: providerMaxRetries
}) : null;

// This app runs behind Apache reverse proxy in production.
app.set("trust proxy", 1);

function isValidModelName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{2,64}$/.test(value);
}

function isValidCopilotModelName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._/-]{2,120}$/.test(value);
}

function resolveCopilotModel(requestedModel) {
  if (!isValidCopilotModelName(requestedModel)) return copilotDefaultModel;
  if (copilotAllowedModels.length > 0 && !copilotAllowedModels.includes(requestedModel)) return copilotDefaultModel;
  return requestedModel;
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

function isValidGoogleModelName(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{2,120}$/.test(value);
}

function resolveGoogleModel(requestedModel) {
  if (!isValidGoogleModelName(requestedModel)) {
    return googleDefaultModel;
  }

  if (googleAllowedModels.length > 0 && !googleAllowedModels.includes(requestedModel)) {
    return googleDefaultModel;
  }

  return requestedModel;
}

const compatibleProviderConfigs = {
  xai: {
    label: "xAI",
    apiKey: xaiApiKey,
    apiBaseUrl: xaiApiBaseUrl,
    defaultModel: xaiDefaultModel,
    allowedModels: xaiAllowedModels,
    supportsAgentMode: true,
    supportsReasoningEffort: true
  },
  google: {
    label: "Google AI",
    apiKey: googleApiKey,
    apiBaseUrl: googleApiBaseUrl,
    defaultModel: googleDefaultModel,
    allowedModels: googleAllowedModels,
    supportsAgentMode: true,
    supportsReasoningEffort: false
  },
  deepseek: {
    label: "DeepSeek",
    apiKey: deepseekApiKey,
    apiBaseUrl: deepseekApiBaseUrl,
    defaultModel: deepseekDefaultModel,
    allowedModels: deepseekAllowedModels,
    agentModels: deepseekAgentModels,
    supportsAgentMode: true,
    supportsReasoningEffort: true
  },
  together: {
    label: "Together AI",
    apiKey: togetherApiKey,
    apiBaseUrl: togetherApiBaseUrl,
    defaultModel: togetherDefaultModel,
    allowedModels: togetherAllowedModels,
    agentModels: togetherAgentModels,
    supportsAgentMode: true,
    supportsReasoningEffort: false
  },
  openrouter: {
    label: "OpenRouter",
    apiKey: openRouterApiKey,
    apiBaseUrl: openRouterApiBaseUrl,
    defaultModel: openRouterDefaultModel,
    allowedModels: openRouterAllowedModels,
    agentModels: openRouterAgentModels,
    supportsAgentMode: true,
    supportsReasoningEffort: false,
    headers: {
      ...(openRouterHttpReferer ? { "HTTP-Referer": openRouterHttpReferer } : {}),
      ...(openRouterTitle ? { "X-OpenRouter-Title": openRouterTitle } : {})
    }
  }
};

const nativeProviderConfigs = {
  anthropic: {
    label: "Anthropic Claude",
    apiKey: anthropicApiKey,
    apiBaseUrl: anthropicApiBaseUrl,
    defaultModel: anthropicDefaultModel,
    allowedModels: anthropicAllowedModels,
    supportsAgentMode: false
  }
};

const externalProviderConfigs = {
  ...compatibleProviderConfigs,
  ...nativeProviderConfigs
};

function configuredExternalProviders() {
  return Object.entries(externalProviderConfigs)
    .filter(([, config]) => Boolean(config.apiKey))
    .map(([provider]) => provider);
}

function configuredProviders() {
  return [
    ...(openaiApiKey ? ["openai"] : []),
    ...(githubPat ? ["copilot"] : []),
    ...configuredExternalProviders()
  ];
}

const configuredProviderIds = configuredProviders();
const defaultProvider = selectDefaultProvider(configuredProviderIds, process.env.DEFAULT_PROVIDER);

function resolveExternalProviderModel(provider, requestedModel) {
  const config = externalProviderConfigs[provider];
  if (!config) {
    return "";
  }
  return resolveProviderModel({
    requestedModel,
    defaultModel: config.defaultModel,
    allowedModels: config.allowedModels
  });
}

function compatibleAgentModelsForConfig(config) {
  if (!Array.isArray(config?.agentModels)) return null;
  const allowedModels = Array.isArray(config.allowedModels) ? config.allowedModels : [];
  return [...new Set(config.agentModels
    .filter(isValidProviderModelName)
    .filter((model) => allowedModels.length === 0 || allowedModels.includes(model)))];
}

function supportsCompatibleAgentModel(provider, model) {
  const config = compatibleProviderConfigs[provider];
  if (!config?.supportsAgentMode) return false;
  const agentModels = compatibleAgentModelsForConfig(config);
  return agentModels === null || agentModels.includes(model);
}

function normalizeReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(normalized)) {
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
    workspaceAgentStepOverrideCodesRaw,
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
      workspaceAgentStepOverrideCodesRaw: String(parsed?.workspaceAgentStepOverrideCodesRaw ?? fallback.workspaceAgentStepOverrideCodesRaw ?? "").trim(),
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
    workspaceAgentStepOverrideCodesRaw: String(update?.workspaceAgentStepOverrideCodesRaw ?? current.workspaceAgentStepOverrideCodesRaw ?? "").trim(),
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
    workspaceAgentStepOverrideCodes: parseWorkspaceUnlockCodes(settings.workspaceAgentStepOverrideCodesRaw, normalizeWorkspaceCode),
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
    workspaceAgentStepOverrideCodes: parseWorkspaceUnlockCodes(settings.workspaceAgentStepOverrideCodesRaw, normalizeWorkspaceCode),
    workspaceUploadBypassCodes: parseWorkspaceUploadBypassCodes(settings.workspaceUploadBypassCodesRaw)
  };
}

function hasValidApiKey(req, security = getEffectiveSecuritySettingsSync()) {
  if (!security.apiKeyAuthEnabled || security.apiKeys.length === 0) {
    return false;
  }
  const providedKey = String(req?.headers?.[security.apiKeyHeaderName] || "").trim();
  return Boolean(providedKey) && security.apiKeys.includes(providedKey);
}

function assertAgentToolAuthorized(req) {
  const security = getEffectiveSecuritySettingsSync();
  if (!security.apiKeyAuthEnabled || security.apiKeys.length === 0) {
    const error = new Error("Agent tools require API key authentication to be configured");
    error.status = 503;
    throw error;
  }
  const internal = req?.internalAgentAuthorization;
  if (internal) {
    const keyStillValid = security.apiKeys.some((value) => createHash("sha256").update(value).digest("hex") === internal.apiKeyFingerprint);
    const workspaceMatches = getWorkspaceContext().code === internal.workspaceCode;
    if (keyStillValid && workspaceMatches) return;
  }
  if (!hasValidApiKey(req, security)) {
    const error = new Error("API key required for agent tools");
    error.status = 401;
    throw error;
  }
}

function getAgentToolProfile(req) {
  return normalizeAgentToolProfile(req?.internalAgentAuthorization?.toolProfile || req?.body?.toolProfile);
}

function assertAgentToolAllowed(req, callName) {
  const profile = getAgentToolProfile(req);
  if (!isAgentToolAllowed(callName, profile)) {
    const error = new Error(`tool '${String(callName || "")}' is not allowed by the '${profile}' profile`);
    error.status = 403;
    throw error;
  }
  const internalTools = req?.internalAgentAuthorization?.allowedTools;
  if (Array.isArray(internalTools) && !internalTools.includes(callName)) {
    const error = new Error(`tool '${String(callName || "")}' is outside this child agent's allow-list`);
    error.status = 403;
    throw error;
  }
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

function hasValidBrowserFileSession(req, pathname) {
  const allowedPaths = new Set(["/api/files/download", "/api/files/media-preview", "/api/files/video-preview"]);
  if ((req.method !== "GET" && req.method !== "HEAD") || !allowedPaths.has(pathname)) {
    return false;
  }

  const cookies = parseCookieHeader(req.headers.cookie || "");
  const token = String(cookies[browserFileSessionCookieName] || "").trim();
  const expiresAt = browserFileSessions.get(token);
  if (!token || !expiresAt) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    browserFileSessions.delete(token);
    return false;
  }
  return true;
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
  const secure = configuredAppBaseUrl.startsWith("https://") ? "; Secure" : "";
  const cookieValue = `${workspaceCookieName}=${encoded}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure}`;
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
  const headerCode = normalizeWorkspaceCode(req.headers["x-workspace-code"]);
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const cookieCode = normalizeWorkspaceCode(cookies[workspaceCookieName]);
  const resolved = headerCode || cookieCode || defaultWorkspaceCode;

  if (allowedWorkspaceCodes.length > 0 && !allowedWorkspaceCodes.includes(resolved)) {
    return null;
  }

  return resolved;
}

function getUploadBypassCode(req) {
  const headerCode = normalizeUploadBypassCode(req.headers["x-upload-bypass-code"] || "");
  return headerCode;
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

function getUploadSessionMetadataPath(uploadId) {
  const safeId = String(uploadId || "").trim();
  if (!/^[a-z0-9-]{8,80}$/i.test(safeId)) {
    throw new Error("invalid upload session id");
  }
  return path.join(getChunkUploadRoot(), `${safeId}.json`);
}

async function persistUploadSession(session) {
  const metadataPath = getUploadSessionMetadataPath(session.id);
  const metadata = {
    id: session.id,
    workspaceCode: session.workspaceCode,
    targetRel: session.targetRel,
    expectedSize: session.expectedSize,
    chunkSizeBytes: session.chunkSizeBytes,
    totalChunks: session.totalChunks,
    nextChunkIndex: session.nextChunkIndex,
    receivedBytes: session.receivedBytes,
    updatedAt: session.updatedAt
  };
  await fsp.writeFile(metadataPath, JSON.stringify(metadata), "utf8");
}

async function deleteUploadSessionFiles(session) {
  await Promise.all([
    session?.tempPath ? fsp.unlink(session.tempPath).catch(() => {}) : Promise.resolve(),
    session?.id ? fsp.unlink(getUploadSessionMetadataPath(session.id)).catch(() => {}) : Promise.resolve()
  ]);
}

function cleanupExpiredUploadSessions() {
  const now = Date.now();
  for (const [id, session] of uploadSessionStore.entries()) {
    if (now - Number(session?.updatedAt || 0) < chunkUploadSessionMaxAgeMs) {
      continue;
    }
    uploadSessionStore.delete(id);
    deleteUploadSessionFiles(session).catch(() => {});
  }
}

async function cleanupExpiredUploadSessionFiles() {
  const uploadRoot = getChunkUploadRoot();
  const entries = await fsp.readdir(uploadRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const now = Date.now();
  const entryNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .slice(0, 1000)
    .map(async (entry) => {
      const metadataPath = path.join(uploadRoot, entry.name);
      try {
        const metadata = JSON.parse(await fsp.readFile(metadataPath, "utf8"));
        if (now - Number(metadata?.updatedAt || 0) < chunkUploadSessionMaxAgeMs) return;
        await deleteUploadSessionFiles({
          id: metadata.id || entry.name.slice(0, -5),
          tempPath: path.join(uploadRoot, `${entry.name.slice(0, -5)}.part`)
        });
      } catch {
        const stat = await fsp.stat(metadataPath).catch(() => null);
        if (stat && now - stat.mtimeMs >= chunkUploadSessionMaxAgeMs) {
          const id = entry.name.slice(0, -5);
          await Promise.all([
            fsp.unlink(metadataPath).catch(() => {}),
            fsp.unlink(path.join(uploadRoot, `${id}.part`)).catch(() => {})
          ]);
        }
      }
    }));
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".part") && !entryNames.has(`${entry.name.slice(0, -5)}.json`))
    .slice(0, 1000)
    .map(async (entry) => {
      const partPath = path.join(uploadRoot, entry.name);
      const stat = await fsp.stat(partPath).catch(() => null);
      if (stat && now - stat.mtimeMs >= chunkUploadSessionMaxAgeMs) {
        await fsp.unlink(partPath).catch(() => {});
      }
    }));
}

async function getUploadSessionOrThrow(uploadId) {
  cleanupExpiredUploadSessions();
  let session = uploadSessionStore.get(uploadId);
  if (!session) {
    const metadata = JSON.parse(await fsp.readFile(getUploadSessionMetadataPath(uploadId), "utf8"));
    const { absolute: targetPath, rel: targetRel } = resolveSandboxPath(metadata.targetRel || "");
    session = {
      ...metadata,
      targetRel,
      targetPath,
      tempPath: path.join(getChunkUploadRoot(), `${uploadId}.part`)
    };
    if (Date.now() - Number(session.updatedAt || 0) >= chunkUploadSessionMaxAgeMs) {
      await deleteUploadSessionFiles(session);
      throw new Error("upload session not found or expired");
    }
    const partStat = await fsp.stat(session.tempPath);
    const partSize = Number(partStat.size || 0);
    const chunkSize = Math.max(1, Number(session.chunkSizeBytes || chunkUploadChunkSizeBytes));
    if (partSize > Number(session.expectedSize || 0)
      || (partSize < Number(session.expectedSize || 0) && partSize % chunkSize !== 0)) {
      throw new Error("upload session data is inconsistent");
    }
    session.receivedBytes = partSize;
    session.nextChunkIndex = partSize === 0 ? 0 : Math.ceil(partSize / chunkSize);
    session.updatedAt = Date.now();
    await persistUploadSession(session);
    uploadSessionStore.set(uploadId, session);
  }
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

const fileShareMimeTypes = new Map([
  [".apng", "image/apng"], [".avif", "image/avif"], [".bmp", "image/bmp"], [".cur", "image/x-icon"],
  [".gif", "image/gif"], [".heic", "image/heic"], [".heif", "image/heif"], [".ico", "image/x-icon"],
  [".jpe", "image/jpeg"], [".jpeg", "image/jpeg"], [".jfif", "image/jpeg"], [".jpg", "image/jpeg"],
  [".png", "image/png"], [".svg", "image/svg+xml"], [".svgz", "image/svg+xml"], [".tif", "image/tiff"],
  [".tiff", "image/tiff"], [".webp", "image/webp"],
  [".3gp", "video/3gpp"], [".avi", "video/x-msvideo"], [".m4v", "video/x-m4v"], [".mkv", "video/x-matroska"],
  [".mov", "video/quicktime"], [".mp4", "video/mp4"], [".mpeg", "video/mpeg"], [".mpg", "video/mpeg"],
  [".ogv", "video/ogg"], [".ts", "video/mp2t"], [".webm", "video/webm"], [".wmv", "video/x-ms-wmv"],
  [".flv", "video/x-flv"], [".f4v", "video/mp4"], [".m2ts", "video/mp2t"], [".mts", "video/mp2t"],
  [".3g2", "video/3gpp2"], [".mpe", "video/mpeg"],
  [".css", "text/css; charset=utf-8"], [".csv", "text/csv; charset=utf-8"], [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"], [".pdf", "application/pdf"], [".txt", "text/plain; charset=utf-8"],
  [".aac", "audio/aac"], [".flac", "audio/flac"], [".m4a", "audio/mp4"], [".mp3", "audio/mpeg"],
  [".oga", "audio/ogg"], [".ogg", "audio/ogg"], [".opus", "audio/ogg"], [".wav", "audio/wav"],
  [".wave", "audio/wav"], [".wma", "audio/x-ms-wma"]
]);

const browserNativeVideoExtensions = new Set([".mp4", ".m4v"]);
const browserImageConversionExtensions = new Set([".tif", ".tiff"]);

function shouldTranscodeVideo(fileName) {
  return fileShareMimeType(fileName).startsWith("video/") && !browserNativeVideoExtensions.has(path.extname(fileName).toLowerCase());
}

function shouldConvertImage(fileName) {
  return browserImageConversionExtensions.has(path.extname(fileName).toLowerCase());
}

function fileShareMimeType(fileName) {
  return fileShareMimeTypes.get(path.extname(String(fileName || "")).toLowerCase()) || "application/octet-stream";
}

function fileShareTokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function scryptBuffer(value, salt, length = 32) {
  return new Promise((resolve, reject) => {
    scrypt(value, salt, length, (error, derivedKey) => error ? reject(error) : resolve(derivedKey));
  });
}

async function readFileShareDb() {
  try {
    const parsed = JSON.parse(await fsp.readFile(fileShareDbPath, "utf8"));
    return Array.isArray(parsed?.shares) ? parsed : { shares: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { shares: [] };
    throw error;
  }
}

function writeFileShareDb(db) {
  const operation = fileShareWriteQueue.then(async () => {
    await fsp.mkdir(path.dirname(fileShareDbPath), { recursive: true });
    const tempPath = `${fileShareDbPath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tempPath, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
    await fsp.rename(tempPath, fileShareDbPath);
  });
  fileShareWriteQueue = operation.catch(() => {});
  return operation;
}

function publicFileShareRecord(share) {
  return {
    id: share.id,
    path: share.relativePath,
    fileName: share.fileName,
    size: share.size,
    mimeType: share.mimeType,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    passwordProtected: Boolean(share.passwordHash),
    encrypted: Boolean(share.encrypted),
    ...publicShareAnalytics(share)
  };
}

async function encryptFileShareToken(token) {
  if (!fileShareEncryptionSecret) return {};
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scryptBuffer(fileShareEncryptionSecret, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  return {
    tokenCiphertext: ciphertext.toString("hex"),
    tokenEncryptionSalt: salt.toString("hex"),
    tokenEncryptionIv: iv.toString("hex"),
    tokenEncryptionTag: cipher.getAuthTag().toString("hex")
  };
}

async function decryptFileShareToken(share) {
  if (!fileShareEncryptionSecret || !share.tokenCiphertext) return "";
  const key = await scryptBuffer(fileShareEncryptionSecret, Buffer.from(share.tokenEncryptionSalt, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(share.tokenEncryptionIv, "hex"));
  decipher.setAuthTag(Buffer.from(share.tokenEncryptionTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(share.tokenCiphertext, "hex")),
    decipher.final()
  ]).toString("utf8");
}

async function encryptFileSharePassword(password) {
  if (!fileShareEncryptionSecret || !password) return {};
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scryptBuffer(fileShareEncryptionSecret, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(password), "utf8"), cipher.final()]);
  return {
    passwordCiphertext: ciphertext.toString("hex"),
    passwordEncryptionSalt: salt.toString("hex"),
    passwordEncryptionIv: iv.toString("hex"),
    passwordEncryptionTag: cipher.getAuthTag().toString("hex")
  };
}

async function decryptFileSharePassword(share) {
  if (!fileShareEncryptionSecret || !share.passwordCiphertext) return "";
  const key = await scryptBuffer(fileShareEncryptionSecret, Buffer.from(share.passwordEncryptionSalt, "hex"));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(share.passwordEncryptionIv, "hex"));
  decipher.setAuthTag(Buffer.from(share.passwordEncryptionTag, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(share.passwordCiphertext, "hex")),
    decipher.final()
  ]).toString("utf8");
}

async function publicFileShareRecordWithUrls(share, publicBaseUrl) {
  const record = publicFileShareRecord(share);
  try {
    const token = await decryptFileShareToken(share);
    const passwordCode = await decryptFileSharePassword(share);
    const baseUrl = String(publicBaseUrl || appBaseUrl).replace(/\/+$/, "");
    return {
      ...record,
      ...(token ? {
        viewUrl: `${baseUrl}/share/${token}`,
        directUrl: `${baseUrl}/share/${token}/content`
      } : {}),
      ...(passwordCode ? { passwordCode } : {})
    };
  } catch {
    return record;
  }
}

function resolveSharedSourcePath(share) {
  if (share.encrypted) {
    const absolute = path.resolve(fileShareDataRoot, String(share.encryptedFile || ""));
    if (!absolute.startsWith(`${fileShareDataRoot}${path.sep}`)) throw new Error("invalid encrypted share path");
    return absolute;
  }
  const workspaceRoot = workspaceContextForCode(share.workspaceCode).sandboxRoot;
  const absolute = path.resolve(workspaceRoot, normalizeSandboxRelativePath(share.relativePath));
  if (absolute !== workspaceRoot && !absolute.startsWith(`${workspaceRoot}${path.sep}`)) throw new Error("invalid shared path");
  return absolute;
}

async function findActiveFileShare(token) {
  const tokenHash = fileShareTokenHash(token);
  const db = await readFileShareDb();
  const share = db.shares.find((item) => item.tokenHash === tokenHash && !item.revokedAt);
  if (!share || (share.expiresAt && Date.parse(share.expiresAt) <= Date.now())) return null;
  return { db, share };
}

function fileShareUnlockCookieName(share) {
  return `raa_share_${share.id}`;
}

function fileShareUnlockValue(share) {
  return createHash("sha256").update(`${share.tokenHash}:${share.passwordHash}`).digest("hex");
}

function isFileShareUnlocked(req, share) {
  if (!share.passwordHash) return true;
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const provided = Buffer.from(String(cookies[fileShareUnlockCookieName(share)] || ""), "utf8");
  const expected = Buffer.from(fileShareUnlockValue(share), "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function escapeShareHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function renderFileSharePage(token, share, { error = "" } = {}) {
  const name = escapeShareHtml(share.fileName);
  const tokenPath = encodeURIComponent(token);
  const contentUrl = `/share/${tokenPath}/content`;
  const locked = Boolean(share.passwordHash);
  const preparingVideo = !share.encrypted && shouldTranscodeVideo(share.fileName);
  const media = share.mimeType.startsWith("video/")
    ? preparingVideo
      ? `<p id="media-status">Preparing browser-compatible video…</p><video id="shared-video" controls preload="metadata" data-content-url="${contentUrl}"></video><script src="/share-media.js" defer></script>`
      : `<video controls preload="metadata" src="${contentUrl}"></video>`
    : share.mimeType.startsWith("audio/")
      ? `<audio controls src="${contentUrl}"></audio>`
      : share.mimeType.startsWith("image/")
        ? `<img src="${contentUrl}" alt="${name}">`
        : "";
  const body = locked
    ? `<form method="post" action="/share/${tokenPath}/unlock"><label>Password<input name="password" type="password" required autofocus></label>${error ? `<p class="error">${escapeShareHtml(error)}</p>` : ""}<button type="submit">Unlock</button></form>`
    : `${media}<p><a href="${contentUrl}">Open or download ${name}</a></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>body{margin:0;background:#101713;color:#eef7f0;font:16px/1.5 system-ui,sans-serif}main{width:min(960px,calc(100% - 32px));margin:8vh auto}h1{font-size:clamp(1.4rem,4vw,2.4rem);overflow-wrap:anywhere}video,img{display:block;width:100%;max-height:72vh;object-fit:contain;background:#050706}audio{width:100%}form{max-width:420px;display:grid;gap:12px}label{display:grid;gap:6px}input,button{font:inherit;padding:10px 12px;border-radius:6px;border:1px solid #63816d}button{cursor:pointer;background:#35b56f;color:#07140c;font-weight:700}.error{color:#ff9d9d}a{color:#74d99c}</style></head><body><main><h1>${name}</h1>${share.encrypted ? "<p>Encrypted share. Seeking may be unavailable.</p>" : ""}${body}</main></body></html>`;
}

async function streamFileShare(req, res, share) {
  let absolute = resolveSharedSourcePath(share);
  let stat = await fsp.stat(absolute);
  let safeName = String(share.fileName || "shared-file").replace(/[\r\n"]/g, "_");
  let mimeType = share.mimeType || fileShareMimeType(safeName);
  if (!share.encrypted && shouldTranscodeVideo(safeName)) {
    const preview = await getCachedVideoPreview(
      absolute,
      safeName,
      `share\0${share.workspaceCode}\0${share.relativePath}\0${stat.size}\0${stat.mtimeMs}`,
      { waitForReady: false }
    );
    if (preview.preparing) {
      res.setHeader("Retry-After", "2");
      return res.status(202).end();
    }
    absolute = preview.absolute;
    stat = await fsp.stat(absolute);
    safeName = preview.rel;
    mimeType = "video/mp4";
  }
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");

  if (share.encrypted) {
    const key = await scryptBuffer(fileShareEncryptionSecret, Buffer.from(share.encryptionSalt, "hex"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(share.encryptionIv, "hex"));
    decipher.setAuthTag(Buffer.from(share.encryptionTag, "hex"));
    res.setHeader("Content-Length", String(share.size));
    await pipeline(fs.createReadStream(absolute), decipher, res);
    return;
  }

  res.setHeader("Accept-Ranges", "bytes");
  const range = String(req.headers.range || "");
  const match = range.match(/^bytes=(\d*)-(\d*)$/);
  if (range && !match) {
    res.setHeader("Content-Range", `bytes */${stat.size}`);
    res.status(416).end();
    return;
  }
  let start = 0;
  let end = stat.size - 1;
  if (match) {
    if (!match[1] && match[2]) {
      start = Math.max(0, stat.size - Number(match[2]));
    } else {
      start = Number(match[1] || 0);
      end = match[2] ? Number(match[2]) : end;
    }
    if (start > end || start >= stat.size || end >= stat.size) {
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      res.status(416).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  }
  res.setHeader("Content-Length", String(end - start + 1));
  await pipeline(fs.createReadStream(absolute, { start, end }), res);
}

function enqueueWorkspaceGitOperation(operation) {
  const workspaceCode = getWorkspaceContext().code;
  const previous = workspaceGitQueues.get(workspaceCode) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  workspaceGitQueues.set(workspaceCode, current);
  current.finally(() => {
    if (workspaceGitQueues.get(workspaceCode) === current) {
      workspaceGitQueues.delete(workspaceCode);
    }
  }).catch(() => {});
  return current;
}

async function runGitCommand(sandboxRoot, args, allowFail = false) {
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

async function runGit(args, allowFail = false) {
  const sandboxRoot = getSandboxRoot();
  return enqueueWorkspaceGitOperation(() => runGitCommand(sandboxRoot, args, allowFail));
}

function selectedGitChangePaths(value) {
  const paths = normalizeGitChangePaths(value);
  if (paths.length === 0) throw new Error("Select at least one workspace file");
  return paths.map((item) => {
    const { rel } = resolveSandboxPath(item);
    if (!rel || rel === ".git" || rel.startsWith(".git/") || isManagedGitPath(rel)) throw new Error("Server metadata cannot be selected");
    return rel;
  });
}

async function getGitChangeCenterStatus() {
  const [{ stdout }, branchesResult] = await Promise.all([
    runGit(["status", "--porcelain=v1", "-z", "--branch"], true),
    runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], true)
  ]);
  const status = parseGitStatusPorcelain(stdout);
  status.files = status.files.filter((file) => !isManagedGitPath(file.path));
  return {
    ...status,
    branches: String(branchesResult.stdout || "").split("\n").map((item) => item.trim()).filter(Boolean),
    clean: status.files.length === 0
  };
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

function getRequestOrigin(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || req?.protocol || "http").split(",")[0].trim() || "http";
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : appBaseUrl.replace(/\/+$/, "");
}

function getPublicBaseUrl(req) {
  return configuredAppBaseUrl || getRequestOrigin(req);
}

function getWorkspaceBareRepoHttpsUrl(req, code = getWorkspaceContext().code) {
  const workspaceCode = normalizeWorkspaceCode(code) || defaultWorkspaceCode;
  const base = workspaceGitHttpsBaseUrl || getRequestOrigin(req);
  return `${base.replace(/\/+$/, "")}/git/${encodeURIComponent(workspaceCode)}.git`;
}

async function ensureWorkspaceGitRemoteSetup(req = null) {
  const bareRepoPath = getWorkspaceBareRepoPath();
  await fsp.mkdir(path.dirname(bareRepoPath), { recursive: true });
  if (!fs.existsSync(path.join(bareRepoPath, "HEAD"))) {
    await execFileAsync("git", ["init", "--bare", bareRepoPath]);
  }
  await execFileAsync("git", ["--git-dir", bareRepoPath, "config", "http.receivepack", "true"]);

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
    remoteSshUrl: getWorkspaceBareRepoSshUrl(req),
    remoteHttpsUrl: getWorkspaceBareRepoHttpsUrl(req)
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
  await fsp.chmod(sandboxRoot, 0o750);
  if (!fs.existsSync(auditLogPath)) {
    await fsp.writeFile(auditLogPath, "", "utf8");
  }

  const gitDirPath = path.join(sandboxRoot, ".git");
  if (!fs.existsSync(gitDirPath)) {
    await runGit(["init"]);
    await runGit(["config", "user.name", gitUserName]);
    await runGit(["config", "user.email", gitUserEmail]);
    await runGit(["checkout", "-B", "main"], true);
    await runGit(buildAutomaticGitAddArgs());
    await runGit(["commit", "--allow-empty", "-m", "Initialize sandbox"]);
  }

  await ensureWorkspaceGitRemoteSetup();
  })();

  workspaceReadyPromises.set(code, readyPromise);
  return readyPromise;
}

async function commitSandboxSnapshot(message, paths = []) {
  const sandboxRoot = getSandboxRoot();
  const scopedPaths = [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))];
  return enqueueWorkspaceGitOperation(async () => {
    await runGitCommand(sandboxRoot, buildAutomaticGitAddArgs(scopedPaths));
    const result = await runGitCommand(sandboxRoot, ["commit", "-m", message], true);
    const nothingToCommit = isNothingToCommit(result);
    if (!nothingToCommit && result.code && result.code !== 0) {
      throw new Error(result.stderr || "git commit failed");
    }
  });
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

function appendUsageLedger(entry) {
  const operation = usageLedgerWriteQueue.then(async () => {
    await fsp.mkdir(path.dirname(usageLedgerPath), { recursive: true });
    await fsp.appendFile(usageLedgerPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  });
  usageLedgerWriteQueue = operation.catch(() => {});
  return operation;
}

async function readUsageLedger(limit = 5000) {
  const raw = await fsp.readFile(usageLedgerPath, "utf8").catch((error) => error?.code === "ENOENT" ? "" : Promise.reject(error));
  return String(raw).split("\n").filter(Boolean).slice(-Math.max(1, Math.min(20_000, limit))).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean).reverse();
}

async function recordProviderUsage(req, result, latencyMs, ok, error = "") {
  const provider = String(result?.provider || req.body?.provider || defaultProvider).trim().toLowerCase();
  const model = String(result?.model || req.body?.model || "unknown").trim() || "unknown";
  const tokens = normalizeTokenUsage(result?.usage || {});
  const price = estimateUsageCost(provider, model, tokens, usagePricing);
  const values = providerLatencyHistory.get(provider) || [];
  providerLatencyHistory.set(provider, [...values, latencyMs].slice(-100));
  await appendUsageLedger({
    timestamp: new Date().toISOString(), workspaceCode: getWorkspaceContext().code,
    traceId: resolveRequestTraceId(req) || createTraceId(), provider, model, ok,
    error: String(error || "").slice(0, 500), latencyMs,
    toolCalls: Array.isArray(result?.executedTools) ? result.executedTools.length : 0,
    ...tokens, ...price
  });
}

async function enforceUsageHardLimits() {
  if (!usageMonthlyHardLimitTokens && !usageMonthlyHardLimitUsd) return;
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { totals } = aggregateUsage(await readUsageLedger(), { workspaceCode: getWorkspaceContext().code, from: monthStart.getTime() });
  if (usageMonthlyHardLimitTokens && totals.totalTokens >= usageMonthlyHardLimitTokens) throw Object.assign(new Error("Monthly workspace token limit reached"), { status: 429 });
  if (usageMonthlyHardLimitUsd && totals.estimatedCostUsd >= usageMonthlyHardLimitUsd) throw Object.assign(new Error("Monthly workspace estimated cost limit reached"), { status: 429 });
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
  let changed = false;
  for (const [id, job] of chatJobStore.entries()) {
    const age = now - Number(new Date(job.updatedAt || job.createdAt || 0).getTime() || 0);
    if (age > chatJobMaxAgeMs) {
      closeChatJobStreams(job);
      chatJobStore.delete(id);
      changed = true;
    }
  }

  if (chatJobStore.size <= chatJobMaxEntries) {
    if (changed) scheduleChatJobStateSave();
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
      changed = true;
    }
  }
  if (changed) scheduleChatJobStateSave();
}

function saveChatJobState() {
  chatJobPersistenceWriteQueue = chatJobPersistenceWriteQueue
    .catch(() => undefined)
    .then(() => writeChatJobState(
      chatJobDbPath,
      serializeChatJobState(chatJobStore.values(), pausedChatJobWorkspaces)
    ));
  return chatJobPersistenceWriteQueue;
}

async function runAutomaticReviewWorkflow(req, job, result) {
  const workflow = createReviewWorkflow();
  const executedTools = Array.isArray(result?.executedTools) ? result.executedTools : [];
  if (!executedTools.some((tool) => String(tool).split(":")[0] === "write_file")) {
    return null;
  }
  const cwd = getSandboxRoot();
  let diff = "";
  let status = "";
  try {
    [{ stdout: status }, { stdout: diff }] = await Promise.all([
      execFileAsync("git", ["status", "--short"], { cwd, timeout: 10_000, maxBuffer: 200_000 }),
      execFileAsync("git", ["diff", "--no-color", "--no-ext-diff"], { cwd, timeout: 10_000, maxBuffer: 1_000_000 })
    ]);
  } catch (error) {
    return { ...workflow, status: "changes_requested", error: String(error?.message || error).slice(0, 1000) };
  }
  const optimizerFindings = /<<<<<<<|=======|>>>>>>>/.test(diff)
    ? ["merge-conflict markers are present in the diff"]
    : [];
  const chaosFindings = /catch\s*\{\s*\}/.test(diff)
    ? ["empty catch block may hide runtime failures"]
    : [];
  const securityFindings = /(password|api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{8,}/i.test(diff)
    ? ["possible credential-like literal detected; verify it is not a secret"]
    : [];
  const reviewDiff = diff.slice(-30_000);
  async function modelStage(stage, deterministicFindings) {
    if (req.body?.reviewWorkflow === false) return { passed: deterministicFindings.length === 0, findings: deterministicFindings };
    const reviewerReq = {
      body: {
        provider: req.body?.provider,
        model: req.body?.model,
        agentMode: false,
        messages: [{ role: "user", content: [
          `You are the ${stage} reviewer in a bounded code-review pipeline.`,
          "Review only the supplied diff. Do not propose tool calls or claim to have run tests.",
          "Return strict JSON only: {\"passed\":true|false,\"findings\":[\"short actionable finding\"]}.",
          "An empty findings array means passed.",
          `Deterministic findings already detected: ${JSON.stringify(deterministicFindings)}`,
          `DIFF:\n${reviewDiff}`
        ].join("\n\n")}]
      },
      headers: req.headers,
      ip: "internal-review",
      workspace: req.workspace,
      traceId: `${job.traceId}-${stage}`,
      abortSignal: req.abortSignal
    };
    try {
      const response = await generateChatResponse(reviewerReq);
      const raw = String(response?.reply || "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(raw);
      const findings = [...deterministicFindings, ...(Array.isArray(parsed?.findings) ? parsed.findings : [])]
        .map((finding) => String(finding || "").trim().slice(0, 2000)).filter(Boolean).slice(0, 20);
      return { passed: findings.length === 0 && parsed?.passed !== false, findings };
    } catch (error) {
      return { passed: false, findings: [...deterministicFindings, `${stage} reviewer unavailable: ${String(error?.message || error).slice(0, 500)}`] };
    }
  }
  const optimizer = await modelStage("optimizer", optimizerFindings);
  const chaos = await modelStage("chaos and edge-case", chaosFindings);
  const security = await modelStage("security", securityFindings);
  let reviewed = recordReviewStage(workflow, "optimizer", optimizer);
  reviewed = recordReviewStage(reviewed, "chaos", chaos);
  reviewed = recordReviewStage(reviewed, "security", security);
  reviewed.statusText = status.trim().slice(0, 4000);
  reviewed.reviewedJobId = job.id;
  await appendAuditLog(req, "agent-review-workflow", {
    jobId: job.id,
    status: reviewed.status,
    findings: [...optimizerFindings, ...chaosFindings, ...securityFindings]
  });
  if (reviewed.status === "changes_requested") {
    await createNotification(req, `Review gate found ${optimizerFindings.length + chaosFindings.length + securityFindings.length} finding(s) for job ${job.id}.`, "warning", {
      kind: "review-gate",
      jobId: job.id,
      status: reviewed.status
    });
  }
  return reviewed;
}

function scheduleChatJobStateSave() {
  if (chatJobPersistenceTimer) return;
  chatJobPersistenceTimer = setTimeout(() => {
    chatJobPersistenceTimer = null;
    saveChatJobState().catch((error) => {
      console.error("Failed to persist chat jobs:", error?.message || error);
    });
  }, 100);
}

function createChatJobExecution(job, requestBody, request = {}) {
  const context = workspaceContextForCode(job.workspaceCode);
  const abortController = new AbortController();
  const security = getEffectiveSecuritySettingsSync();
  const providedApiKey = String(request.headers?.[security.apiKeyHeaderName] || "").trim();
  const executionApiKey = security.apiKeys.includes(providedApiKey) ? providedApiKey : security.apiKeys[0] || "";
  const reqClone = {
    body: JSON.parse(JSON.stringify(requestBody || {})),
    headers: {
      "user-agent": String(request.headers?.["user-agent"] || "restored-chat-job").slice(0, 300),
      ...(executionApiKey ? { [security.apiKeyHeaderName]: executionApiKey } : {})
    },
    ip: request.ip || "queue-recovery",
    workspace: { code: job.workspaceCode },
    traceId: job.traceId,
    chatJobId: job.id,
    abortSignal: abortController.signal,
    onJobEvent: (type, payload) => {
      const current = chatJobStore.get(job.id);
      if (current) recordChatJobEvent(current, type, payload);
    }
  };
  return { context, reqClone, abortController };
}

async function loadChatJobState() {
  try {
    const restored = restoreChatJobState(await readChatJobState(chatJobDbPath));
    for (const workspaceCode of restored.pausedWorkspaceCodes) pausedChatJobWorkspaces.add(workspaceCode);
    for (const job of restored.jobs) {
      if (job.status === "queued" && job.requestBody) {
        job.execution = createChatJobExecution(job, job.requestBody);
      }
      chatJobStore.set(job.id, job);
      const counterMatch = String(job.id).match(/-(\d+)$/);
      if (counterMatch) chatJobCounter = Math.max(chatJobCounter, Number(counterMatch[1]) + 1);
    }
    pruneChatJobs();
    await saveChatJobState();
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Failed to load chat jobs:", error?.message || error);
  }
}

function createChatJob(req, provider, agentMode) {
  pruneChatJobs();
  const id = `job-${Date.now()}-${chatJobCounter++}`;
  const traceId = resolveRequestTraceId(req) || createTraceId();
  const workspace = getWorkspaceContext();
  const createdAt = new Date().toISOString();
  const requestMessages = Array.isArray(req?.body?.messages) ? req.body.messages : [];
  const recoveryPrompt = [...requestMessages].reverse().find((message) => message?.role === "user")?.content || "";
  const job = {
    id,
    traceId,
    status: "queued",
    priority: normalizeChatJobPriority(req?.body?.priority),
    provider,
    agentMode: Boolean(agentMode),
    toolProfile: getAgentToolProfile(req),
    autoCheckpoint: Boolean(req?.body?.autoCheckpoint) && Boolean(agentMode),
    checkpoint: null,
    workspaceCode: workspace.code,
    createdAt,
    updatedAt: createdAt,
    cancelRequested: false,
    cancelledAt: null,
    listeners: new Set(),
    events: [],
    abortController: null,
    result: null,
    error: null,
    recovery: {
      clientChatId: String(req?.body?.clientChatId || "").slice(0, 120),
      clientUserMessageId: String(req?.body?.clientUserMessageId || "").slice(0, 120),
      prompt: String(recoveryPrompt).slice(0, chatMessageMaxChars),
      model: String(req?.body?.model || "").slice(0, 120)
    },
    requestBody: JSON.parse(JSON.stringify(req?.body || {}))
  };
  recordChatJobEvent(job, "queued", {
    provider,
    priority: job.priority,
    agentMode: Boolean(agentMode),
    toolProfile: job.toolProfile,
    autoCheckpoint: job.autoCheckpoint,
    traceId
  });
  chatJobStore.set(id, job);
  scheduleChatJobStateSave();
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
  scheduleChatJobStateSave();

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
  scheduleChatJobStateSave();
}

function cancelChatJob(job, reason = "Cancelled by user") {
  if (!job) {
    return false;
  }
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return false;
  }
  const wasQueued = job.status === "queued";
  if (job.abortController) {
    try {
      job.abortController.abort(reason);
    } catch {
      // Ignore abort errors.
    }
  }
  for (const child of subagentJobStore.values()) {
    if (child.parentId === job.id && ["queued", "running"].includes(child.status)) {
      cancelSubagentJob(child, "Parent job cancelled");
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
  if (wasQueued && job.scheduleId) {
    queueMicrotask(() => {
      finishScheduledAgentRecipeJob(job).catch((error) => {
        console.error("Failed to finalize cancelled scheduled recipe:", error?.message || error);
      });
    });
  }
  queueMicrotask(dispatchChatJobs);
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
    priority: job.priority,
    queuePosition: getChatJobQueuePosition(job),
    provider: job.provider,
    agentMode: job.agentMode,
    toolProfile: job.toolProfile,
    autoCheckpoint: job.autoCheckpoint,
    checkpoint: job.checkpoint,
    workspaceCode: job.workspaceCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    cancelRequested: Boolean(job.cancelRequested),
    cancelledAt: job.cancelledAt || null,
    recovery: job.recovery || null,
    question: job.question || null,
    result: job.status === "completed" ? job.result : null,
    error: ["failed", "cancelled"].includes(job.status) ? job.error : null
  };
}

function getChatJobQueuePosition(job) {
  if (!job || job.status !== "queued") {
    return null;
  }
  const queued = [...chatJobStore.values()]
    .filter((item) => item.workspaceCode === job.workspaceCode && item.status === "queued")
    .sort(compareQueuedChatJobs);
  const index = queued.findIndex((item) => item.id === job.id);
  return index >= 0 ? index + 1 : null;
}

function activeChatJobCount() {
  return [...chatJobStore.values()]
    .filter((job) => ["starting", "checkpointing", "running"].includes(job.status))
    .length;
}

function activeWorkspaceChatJobCount(workspaceCode) {
  return [...chatJobStore.values()]
    .filter((job) => job.workspaceCode === workspaceCode && ["starting", "checkpointing", "running"].includes(job.status))
    .length;
}

function workspaceChatJobLimit(workspaceCode) {
  return chatJobWorkspaceConcurrency.get(workspaceCode) || chatJobDefaultWorkspaceConcurrent;
}

function startQueuedChatJob(job) {
  const execution = job?.execution;
  if (!job || !execution || job.status !== "queued") {
    return;
  }
  setChatJobStatus(job, "starting", { eventPayload: { priority: job.priority, traceId: job.traceId } });
  job.abortController = execution.abortController;

  workspaceContextStore.run(execution.context, async () => {
    try {
      if (job.cancelRequested || job.status === "cancelled") {
        return;
      }
      if (job.autoCheckpoint) {
        setChatJobStatus(job, "checkpointing", { eventPayload: { traceId: job.traceId } });
        job.checkpoint = await createManualSnapshot(`agent checkpoint ${job.traceId}`);
        recordChatJobEvent(job, "checkpoint-created", {
          traceId: job.traceId,
          checkpoint: job.checkpoint
        });
      }
      setChatJobStatus(job, "running", { eventPayload: { provider: job.provider, traceId: job.traceId } });
      const result = await generateChatResponse(execution.reqClone);
      result.review = await runAutomaticReviewWorkflow(execution.reqClone, job, result);
      result.contextMutations = Array.isArray(execution.reqClone.agentContextMutations)
        ? execution.reqClone.agentContextMutations
        : [];
      result.checkpoint = job.checkpoint;
      if (job.status !== "cancelled") {
        setChatJobStatus(job, "completed", { result, eventPayload: { traceId: job.traceId } });
      }
    } catch (error) {
      if (error?.code === "USER_INPUT_REQUIRED" && job.status !== "cancelled") {
        job.question = error.question || job.question || null;
        setChatJobStatus(job, "needs_input", {
          eventPayload: { traceId: job.traceId, questionId: job.question?.id || null }
        });
        await saveChatJobState();
      } else if (job.status !== "cancelled") {
        setChatJobStatus(job, "failed", {
          error: {
            message: String(error?.message || error),
            status: Number(error?.status || 500),
            traceId: job.traceId
          },
          eventPayload: { traceId: job.traceId }
        });
      }
    } finally {
      job.abortController = null;
      if (job.status !== "needs_input") {
        job.execution = null;
      }
      if (job.status !== "needs_input") await finishScheduledAgentRecipeJob(job);
      if (job.status !== "needs_input") dispatchChatJobs();
    }
  });
}

function dispatchChatJobs() {
  const slots = chatJobMaxConcurrent - activeChatJobCount();
  if (slots <= 0) {
    return;
  }
  const ready = selectDispatchableChatJobs(chatJobStore.values(), {
    globalSlots: slots,
    defaultWorkspaceLimit: chatJobDefaultWorkspaceConcurrent,
    workspaceLimits: chatJobWorkspaceConcurrency,
    pausedWorkspaceCodes: pausedChatJobWorkspaces
  });
  for (const job of ready) {
    startQueuedChatJob(job);
  }
}

function enqueueChatJob(req) {
  const provider = String(req.body?.provider || defaultProvider).trim().toLowerCase();
  const agentMode = Boolean(req.body?.agentMode);
  const job = createChatJob(req, provider, agentMode);
  job.execution = createChatJobExecution(job, job.requestBody, req);
  queueMicrotask(dispatchChatJobs);
  return job;
}

function publicAgentRecipeSchedule(schedule) {
  const lastJob = schedule.lastJobId ? chatJobStore.get(schedule.lastJobId) : null;
  return {
    ...schedule,
    timer: undefined,
    lastJobStatus: lastJob?.status || schedule.lastJobStatus || null
  };
}

async function saveAgentRecipeSchedules() {
  await fsp.mkdir(path.dirname(agentRecipeScheduleDbPath), { recursive: true });
  const schedules = [...agentRecipeScheduleStore.values()].map((schedule) => {
    const { timer, ...stored } = schedule;
    return stored;
  });
  await fsp.writeFile(agentRecipeScheduleDbPath, `${JSON.stringify({ version: 1, schedules }, null, 2)}\n`, "utf8");
}

function resolveScheduledProviderModel(providerValue, modelValue) {
  const provider = String(providerValue || defaultProvider).trim().toLowerCase();
  if (compatibleProviderConfigs[provider]?.apiKey && compatibleProviderConfigs[provider].supportsAgentMode) {
    return { provider, model: resolveExternalProviderModel(provider, modelValue) };
  }
  if (provider === "copilot" && githubPat) {
    return { provider, model: resolveCopilotModel(modelValue) };
  }
  if (provider === "openai" && openaiApiKey) return { provider, model: resolveModel(modelValue) };
  throw new Error(`Provider '${provider}' is not configured for scheduled agents`);
}

async function finishScheduledAgentRecipeJob(job) {
  if (!job?.scheduleId) return;
  const schedule = agentRecipeScheduleStore.get(job.scheduleId);
  if (!schedule) return;
  schedule.lastJobStatus = job.status;
  schedule.lastCompletedAt = new Date().toISOString();
  await saveAgentRecipeSchedules();
  const syntheticReq = { ip: "scheduler", headers: { "user-agent": "agent-recipe-scheduler" }, traceId: job.traceId };
  const level = job.status === "completed" ? "success" : job.status === "cancelled" ? "warning" : "error";
  await createNotification(syntheticReq, `Scheduled recipe ${schedule.name} ${job.status}.`, level);
}

function armAgentRecipeSchedule(schedule) {
  if (schedule.timer) clearTimeout(schedule.timer);
  schedule.timer = null;
  if (!schedule.enabled || !schedule.nextRunAt) return;
  const delayMs = Math.max(0, Date.parse(schedule.nextRunAt) - Date.now());
  const boundedDelay = Math.min(delayMs, 2_147_000_000);
  schedule.timer = setTimeout(() => {
    if (delayMs > boundedDelay) {
      armAgentRecipeSchedule(schedule);
      return;
    }
    runScheduledAgentRecipe(schedule.id).catch((error) => {
      console.error("Scheduled agent recipe failed:", error?.message || error);
    });
  }, boundedDelay);
}

async function runScheduledAgentRecipe(scheduleId) {
  const schedule = agentRecipeScheduleStore.get(scheduleId);
  if (!schedule?.enabled) return;
  const previousJob = schedule.lastJobId ? chatJobStore.get(schedule.lastJobId) : null;
  if (previousJob && !["completed", "failed", "cancelled"].includes(previousJob.status)) {
    schedule.lastJobStatus = "overlap-skipped";
  } else {
    const context = workspaceContextForCode(schedule.workspaceCode);
    await workspaceContextStore.run(context, async () => {
      const syntheticReq = {
        body: {
          provider: schedule.provider,
          model: schedule.model,
          agentMode: true,
          priority: schedule.priority,
          toolProfile: schedule.toolProfile,
          autoCheckpoint: schedule.autoCheckpoint,
          messages: [{ role: "user", content: schedule.prompt }]
        },
        headers: { "user-agent": "agent-recipe-scheduler" },
        ip: "scheduler",
        workspace: { code: schedule.workspaceCode }
      };
      const job = enqueueChatJob(syntheticReq);
      job.scheduleId = schedule.id;
      schedule.lastJobId = job.id;
      schedule.lastJobStatus = job.status;
      schedule.lastRunAt = new Date().toISOString();
      await appendAuditLog(syntheticReq, "agent-recipe-scheduled-run", {
        scheduleId: schedule.id,
        name: schedule.name,
        jobId: job.id,
        provider: schedule.provider,
        model: schedule.model
      });
    });
  }

  if (schedule.kind === "once") {
    schedule.enabled = false;
    schedule.nextRunAt = null;
  } else {
    schedule.nextRunAt = calculateNextRunAt(schedule, Date.now());
  }
  await saveAgentRecipeSchedules();
  armAgentRecipeSchedule(schedule);
}

async function loadAgentRecipeSchedules() {
  try {
    const raw = await fsp.readFile(agentRecipeScheduleDbPath, "utf8");
    const parsed = JSON.parse(raw);
    for (const item of Array.isArray(parsed?.schedules) ? parsed.schedules : []) {
      if (!item?.id || !item?.workspaceCode || !item?.prompt) continue;
      const schedule = { ...item, timer: null };
      if (schedule.enabled && (!schedule.nextRunAt || Date.parse(schedule.nextRunAt) <= Date.now())) {
        schedule.nextRunAt = new Date(Date.now() + 1000).toISOString();
      }
      agentRecipeScheduleStore.set(schedule.id, schedule);
      armAgentRecipeSchedule(schedule);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Failed to load agent recipe schedules:", error?.message || error);
  }
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

function resolveMessageContext(body) {
  return resolveProviderMessageContext(body, {
    messageMaxChars: chatMessageMaxChars,
    contextMaxChars: chatContextMaxChars,
    summaryMaxChars: chatCompactionSummaryMaxChars
  });
}

async function getFileList(pathValue) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const entries = await fsp.readdir(absolute, { withFileTypes: true });
  const mapped = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(absolute, entry.name);
    const stat = await fsp.stat(entryPath);
    const summary = entry.isDirectory()
      ? await summarizeDirectoryContents(entryPath)
      : { size: stat.size, fileCount: 1, directoryCount: 0 };
    return {
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
      size: summary.size,
      fileCount: summary.fileCount,
      directoryCount: summary.directoryCount,
      mode: (stat.mode & 0o777).toString(8).padStart(3, "0"),
      hidden: entry.name.startsWith("."),
      executable: !entry.isDirectory() && Boolean(stat.mode & 0o111),
      modifiedAt: stat.mtime.toISOString()
    };
  }));
  mapped.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return { path: rel, entries: mapped };
}

async function getBrowserVideoPreview(pathValue, { waitForReady = true } = {}) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const stat = await fsp.stat(absolute);
  if (!stat.isFile()) {
    throw new Error("video preview path must be a file");
  }

  if (!shouldTranscodeVideo(rel)) {
    return { absolute, rel, transcoded: false };
  }

  return getCachedVideoPreview(
    absolute,
    rel,
    `${getWorkspaceContext().code}\0${rel}\0${stat.size}\0${stat.mtimeMs}`,
    { waitForReady }
  );
}

async function getCachedVideoPreview(absolute, rel, cacheIdentity, { waitForReady = true } = {}) {
  const cacheKey = createHash("sha256").update(cacheIdentity).digest("hex");
  const outputPath = path.join(videoPreviewCacheRoot, `${cacheKey}.mp4`);
  await fsp.mkdir(videoPreviewCacheRoot, { recursive: true });

  try {
    const cachedStat = await fsp.stat(outputPath);
    if (cachedStat.isFile() && cachedStat.size > 0) {
      return { absolute: outputPath, rel: `${path.basename(rel, path.extname(rel))}.mp4`, transcoded: true };
    }
  } catch {
    // Generate the preview below.
  }

  let job = videoPreviewJobs.get(cacheKey);
  if (job?.error) {
    throw job.error;
  }
  if (!job) {
    job = { promise: null, error: null };
    job.promise = (async () => {
      const tempPath = `${outputPath}.${process.pid}.tmp.mp4`;
      try {
        await execFileAsync("ffmpeg", [
          "-y", "-i", absolute,
          "-map", "0:v:0", "-map", "0:a:0?",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
          tempPath
        ], { timeout: videoPreviewTranscodeTimeoutMs, maxBuffer: 2 * 1024 * 1024 });
        await fsp.rename(tempPath, outputPath);
      } finally {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
      }
    })();
    videoPreviewJobs.set(cacheKey, job);
    job.promise.then(
      () => videoPreviewJobs.delete(cacheKey),
      (error) => {
        job.error = error;
        setTimeout(() => {
          if (videoPreviewJobs.get(cacheKey) === job) videoPreviewJobs.delete(cacheKey);
        }, 5 * 60 * 1000).unref?.();
      }
    );
  }
  if (!waitForReady) {
    return { rel: `${path.basename(rel, path.extname(rel))}.mp4`, transcoded: true, preparing: true };
  }
  await job.promise;
  return { absolute: outputPath, rel: `${path.basename(rel, path.extname(rel))}.mp4`, transcoded: true };
}

async function getBrowserImagePreview(pathValue) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const stat = await fsp.stat(absolute);
  if (!stat.isFile()) {
    throw new Error("image preview path must be a file");
  }
  if (!shouldConvertImage(rel)) {
    return { absolute, rel, converted: false };
  }

  const cacheKey = createHash("sha256")
    .update(`${getWorkspaceContext().code}\0${rel}\0${stat.size}\0${stat.mtimeMs}`)
    .digest("hex");
  const outputPath = path.join(imagePreviewCacheRoot, `${cacheKey}.png`);
  await fsp.mkdir(imagePreviewCacheRoot, { recursive: true });
  try {
    const cachedStat = await fsp.stat(outputPath);
    if (cachedStat.isFile() && cachedStat.size > 0) {
      return { absolute: outputPath, rel: `${path.basename(rel, path.extname(rel))}.png`, converted: true };
    }
  } catch {
    // Generate the preview below.
  }

  let job = imagePreviewJobs.get(cacheKey);
  if (!job) {
    job = (async () => {
      const tempPath = `${outputPath}.${process.pid}.tmp.png`;
      try {
        await execFileAsync("ffmpeg", ["-y", "-i", absolute, "-frames:v", "1", tempPath], {
          timeout: Math.min(videoPreviewTranscodeTimeoutMs, 120_000),
          maxBuffer: 2 * 1024 * 1024
        });
        await fsp.rename(tempPath, outputPath);
      } finally {
        await fsp.rm(tempPath, { force: true }).catch(() => {});
      }
    })();
    imagePreviewJobs.set(cacheKey, job);
    job.finally(() => imagePreviewJobs.delete(cacheKey)).catch(() => {});
  }
  await job;
  return { absolute: outputPath, rel: `${path.basename(rel, path.extname(rel))}.png`, converted: true };
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

async function writeTextFile(pathValue, content, options = {}) {
  const { absolute, rel } = resolveSandboxPath(pathValue || "");
  const text = typeof content === "string" ? content : "";
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, text, "utf8");
  if (options.snapshot !== false) await commitSandboxSnapshot(`write ${rel || "."}`, [rel]);
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

async function copySandboxPath(fromPath, toPath) {
  const { absolute: fromAbs, rel: fromRel } = resolveSandboxPath(fromPath || "");
  const { absolute: toAbs, rel: toRel } = resolveSandboxPath(toPath || "");
  if (!fromRel) {
    throw new Error("refusing to duplicate sandbox root");
  }
  if (!toRel) {
    throw new Error("destination path is required");
  }
  const sourceStat = await fsp.stat(fromAbs);
  await fsp.mkdir(path.dirname(toAbs), { recursive: true });
  await fsp.cp(fromAbs, toAbs, { recursive: true, errorOnExist: true, force: false });
  await commitSandboxSnapshot(`copy ${fromRel} -> ${toRel}`);
  return { ok: true, fromPath: fromRel, toPath: toRel, type: sourceStat.isDirectory() ? "directory" : "file" };
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

function makeDownloadArchiveName(sourceRel) {
  const base = path.basename(sourceRel || "workspace").replace(/^\.+/, "") || "workspace";
  return `${base}.zip`;
}

async function createDirectoryDownloadZip(sourceAbs, sourceRel) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "remote-ai-download-"));
  const zipName = makeDownloadArchiveName(sourceRel);
  const zipPath = path.join(tempDir, zipName);
  const cwd = sourceRel ? path.dirname(sourceAbs) : sourceAbs;
  const includeTarget = sourceRel ? path.basename(sourceAbs) : ".";
  try {
    await execFileAsync("zip", ["-r", "-q", zipPath, includeTarget], { cwd, timeout: 300000 });
    return { zipPath, zipName, tempDir };
  } catch (error) {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`zip command failed. Ensure 'zip' is installed. ${String(error?.stderr || error?.message || "")}`.trim());
  }
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

function isAllowedDockerAbsolutePath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  return allowedDockerAbsolutePathPrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

function isTerminalArgOutsideWorkspace(arg, runtime = terminalRuntime) {
  const value = String(arg || "").trim();
  if (!value || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    return false;
  }
  if (runtime === "docker" && isAllowedDockerAbsolutePath(value)) {
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

function isValidDockerImageName(value) {
  const image = String(value || "").trim();
  return /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/.test(image)
    && image.length <= 240
    && !image.includes("..");
}

function normalizeRequestedDockerImage(value) {
  const image = String(value || terminalDockerImage).trim() || terminalDockerImage;
  if (!isValidDockerImageName(image)) {
    throw new Error(`docker image '${image}' is invalid`);
  }
  if (!terminalDockerAllowedImages.has(image)) {
    throw new Error(`docker image '${image}' is not allow-listed`);
  }
  return image;
}

async function runWorkspaceCommandInDocker(commandName, commandArgs, cwdRel, timeout, sandboxRoot, envVars, dockerImage) {
  const image = normalizeRequestedDockerImage(dockerImage);
  const inContainerCwd = cwdRel ? `/workspace/${cwdRel}` : "/workspace";
  const containerName = `raa-tool-${process.pid}-${randomBytes(6).toString("hex")}`;
  const dockerArgs = [
    "run",
    "--rm",
    "--name", containerName,
    "--label", MANAGED_TOOL_CONTAINER_LABEL,
    "--log-driver", "json-file",
    "--log-opt", "max-size=10m",
    "--log-opt", "max-file=3",
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

  dockerArgs.push(image, commandName, ...commandArgs);
  try {
    return await execFileAsync("docker", dockerArgs, { timeout });
  } finally {
    await execFileAsync("docker", ["rm", "-f", containerName], { timeout: 15_000 }).catch(() => {});
  }
}

async function prepareTerminalExecution(cwdPath) {
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
    PATH: "/workspace/.venv/bin:/workspace/venv/bin:/workspace/.python-packages/bin:/workspace/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
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
    PYTHONPATH: "/workspace/.python-packages",
    npm_config_prefix: "/workspace/.npm-global",
    npm_config_cache: "/workspace/.cache/npm"
  };

  return { cwdAbs, cwdRel, sandboxRoot, hostExecEnv, containerExecEnv };
}

async function runDockerShellCommand(commandLine, cwdPath, timeoutMs, options = {}) {
  const command = String(commandLine || "").trim();
  if (!command) {
    throw new Error("command is required");
  }
  const dockerImage = normalizeRequestedDockerImage(options?.dockerImage);

  const maxTimeout = 900000;
  const defaultTimeout = 60000;
  const timeout = Math.max(1000, Math.min(maxTimeout, Number(timeoutMs || defaultTimeout)));
  const { cwdRel, sandboxRoot, containerExecEnv } = await prepareTerminalExecution(cwdPath || "");

  try {
    const result = await runWorkspaceCommandInDocker("sh", ["-lc", command], cwdRel, timeout, sandboxRoot, containerExecEnv, dockerImage);
    return {
      ok: true,
      command,
      executable: "sh",
      resolvedBy: "docker-shell",
      args: ["-lc", command],
      cwd: cwdRel,
      runtime: "docker",
      dockerImage,
      stdout: String(result.stdout || "").slice(0, 12000),
      stderr: String(result.stderr || "").slice(0, 12000)
    };
  } catch (error) {
    return {
      ok: false,
      command,
      executable: "sh",
      resolvedBy: "docker-shell",
      args: ["-lc", command],
      cwd: cwdRel,
      runtime: "docker",
      dockerImage,
      code: Number(error?.code || 1),
      stdout: String(error?.stdout || "").slice(0, 12000),
      stderr: String(error?.stderr || error?.message || "").slice(0, 12000)
    };
  }
}

async function runSingleSafeTerminalCommand(commandName, args, cwdPath, timeoutMs, options = {}) {
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
  const requestedDockerImage = String(options?.dockerImage || "").trim();
  const dockerImage = effectiveRuntime === "docker" ? normalizeRequestedDockerImage(requestedDockerImage) : null;

  if (requestedDockerImage && effectiveRuntime !== "docker") {
    throw new Error("dockerImage is only available for commands that run in Docker runtime");
  }

  if (effectiveRuntime === "host" && blockedTerminalCommandsHostOnly.has(name)) {
    throw new Error(`command '${name}' is blocked in host terminal runtime`);
  }

  for (const arg of commandArgs) {
    if (effectiveRuntime !== "docker" && blockedTerminalArgPatterns.some((pattern) => pattern.test(arg))) {
      throw new Error(`argument '${arg}' is not allowed`);
    }
    if (isTerminalArgOutsideWorkspace(arg, effectiveRuntime)) {
      throw new Error(`argument '${arg}' points outside the workspace`);
    }
  }

  if (effectiveRuntime !== "docker" && name === "npm" && commandArgs.some((arg) => arg === "-g" || arg === "--global")) {
    throw new Error("npm global installs are blocked; use workspace-local installs only");
  }

  if (effectiveRuntime !== "docker" && (name === "pip" || name === "pip3") && commandArgs.some((arg) => /^--(prefix|root|target)=?/i.test(arg))) {
    throw new Error("pip path overrides are blocked");
  }

  if (effectiveRuntime !== "docker"
    && (name === "python" || name === "python3")
    && commandArgs.length >= 2
    && commandArgs[0] === "-m"
    && commandArgs[1] === "pip"
    && commandArgs.some((arg) => /^--(prefix|root|target)=?/i.test(arg))) {
    throw new Error("python -m pip path overrides are blocked");
  }

  const maxTimeout = effectiveRuntime === "docker" ? 300000 : 60000;
  const defaultTimeout = effectiveRuntime === "docker" ? 45000 : 15000;
  const timeout = Math.max(1000, Math.min(maxTimeout, Number(timeoutMs || defaultTimeout)));
  const { cwdAbs, cwdRel, sandboxRoot, hostExecEnv, containerExecEnv } = await prepareTerminalExecution(cwdPath || "");

  try {
    const result = effectiveRuntime === "docker"
      ? await runWorkspaceCommandInDocker(commandToExecute, commandArgs, cwdRel, timeout, sandboxRoot, containerExecEnv, dockerImage)
      : await execFileAsync(commandToExecute, commandArgs, { cwd: cwdAbs, timeout, env: hostExecEnv });
    return {
      ok: true,
      command: name,
      executable: commandToExecute,
      resolvedBy: invocation.resolvedBy,
      args: commandArgs,
      cwd: cwdRel,
      runtime: effectiveRuntime,
      dockerImage,
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
      dockerImage,
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
    dockerImage: result.dockerImage || null,
    ok: result.ok,
    code: result.code || 0,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function runSafeTerminalCommand(commandName, args, cwdPath, timeoutMs, options = {}) {
  const requestedDockerImage = String(options?.dockerImage || "").trim();
  if (requestedDockerImage && terminalRuntime !== "docker") {
    throw new Error("dockerImage is only available when TERMINAL_RUNTIME=docker");
  }

  if (terminalRuntime === "docker" && terminalDockerShellCommandLines && (!Array.isArray(args) || args.length === 0)) {
    return runDockerShellCommand(commandName, cwdPath, timeoutMs, options);
  }

  const segments = parseTerminalCommandSegments(commandName, args);

  if (segments.length === 1) {
    return runSingleSafeTerminalCommand(segments[0].command, segments[0].args, cwdPath, timeoutMs, options);
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

    const result = await runSingleSafeTerminalCommand(segment.command, segment.args, currentCwd, timeoutMs, options);
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
    dockerImage: finalResult.dockerImage || (requestedDockerImage ? normalizeRequestedDockerImage(requestedDockerImage) : null),
    code: finalResult.code || 0,
    stdout: stdout.slice(0, 12000),
    stderr: stderr.slice(0, 12000),
    commands: results
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function normalizeBuildPath(value, fallback) {
  const raw = String(value || fallback || "").trim();
  if (!raw) {
    return "";
  }
  if (isTerminalArgOutsideWorkspace(raw, terminalRuntime)) {
    throw new Error(`build path '${raw}' points outside the workspace`);
  }
  return raw.replaceAll("\\", "/");
}

function normalizeBuildJobs(value) {
  const jobs = Number(value || 0);
  if (!Number.isFinite(jobs) || jobs <= 0) {
    return "$(nproc 2>/dev/null || echo 2)";
  }
  return String(Math.max(1, Math.min(64, Math.floor(jobs))));
}

function normalizePackageNames(packages) {
  const list = Array.isArray(packages) ? packages : String(packages || "").split(/[,\s]+/);
  const normalized = list
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  for (const item of normalized) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9+._:-]*$/.test(item)) {
      throw new Error(`package name '${item}' is not allowed`);
    }
  }
  return normalized;
}

async function runBuildTool(params = {}) {
  const profile = String(params?.profile || params?.action || "custom").trim().toLowerCase();
  const cwd = String(params?.cwd || "").trim();
  const timeoutMs = Number(params?.timeoutMs || 600000);
  const dockerImage = String(params?.dockerImage || "").trim();
  const sourceDir = normalizeBuildPath(params?.sourceDir, ".");
  const buildDir = normalizeBuildPath(params?.buildDir, "build");
  const target = String(params?.target || "").trim();
  const jobs = normalizeBuildJobs(params?.jobs);
  const extraArgs = Array.isArray(params?.args) ? params.args.map((item) => String(item)).filter(Boolean) : [];
  let command = "";

  switch (profile) {
    case "custom":
    case "command":
      command = String(params?.command || "").trim();
      if (!command) {
        throw new Error("command is required for custom build profile");
      }
      break;
    case "cmake-configure":
      command = ["cmake", "-S", shellQuote(sourceDir), "-B", shellQuote(buildDir), ...extraArgs.map(shellQuote)].join(" ");
      break;
    case "cmake-build":
      command = ["cmake", "--build", shellQuote(buildDir), "--parallel", jobs, target ? "--target" : "", target ? shellQuote(target) : "", ...extraArgs.map(shellQuote)].filter(Boolean).join(" ");
      break;
    case "cmake-test":
    case "ctest":
      command = ["ctest", "--test-dir", shellQuote(buildDir), "--output-on-failure", ...extraArgs.map(shellQuote)].join(" ");
      break;
    case "make":
      command = ["make", `-j${jobs}`, target ? shellQuote(target) : "", ...extraArgs.map(shellQuote)].filter(Boolean).join(" ");
      break;
    case "ninja":
      command = ["ninja", "-C", shellQuote(buildDir), target ? shellQuote(target) : "", ...extraArgs.map(shellQuote)].filter(Boolean).join(" ");
      break;
    case "gcc":
    case "g++":
    case "cc":
    case "c++":
      command = [profile, ...extraArgs.map(shellQuote)].join(" ");
      break;
    case "python-venv":
      command = "python3 -m venv .venv && . .venv/bin/activate && python -m pip install --upgrade pip setuptools wheel";
      break;
    case "pip-install": {
      const packages = normalizePackageNames(params?.packages || extraArgs);
      if (packages.length === 0) {
        throw new Error("packages are required for pip-install");
      }
      command = `. .venv/bin/activate 2>/dev/null || true; python -m pip install ${packages.map(shellQuote).join(" ")}`;
      break;
    }
    case "apt-install": {
      if (terminalRuntime !== "docker") {
        throw new Error("apt-install build profile is only available when TERMINAL_RUNTIME=docker");
      }
      const packages = normalizePackageNames(params?.packages || extraArgs);
      if (packages.length === 0) {
        throw new Error("packages are required for apt-install");
      }
      command = `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages.map(shellQuote).join(" ")}`;
      break;
    }
    default:
      throw new Error("unsupported build profile");
  }

  const result = await runSafeTerminalCommand(command, [], cwd, timeoutMs, { dockerImage });
  return { ...result, profile, buildCommand: command, dockerImage: result.dockerImage || null };
}

function normalizeGitRefName(value, label = "ref") {
  const ref = String(value || "").trim();
  if (!ref || !/^[A-Za-z0-9._/@-]{1,200}$/.test(ref) || ref.includes("..") || ref.endsWith(".lock")) {
    throw new Error(`${label} is invalid`);
  }
  return ref;
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
    case "branch_list": {
      const result = await runGit(["branch", "--all", "--verbose", "--no-abbrev"], true);
      return { ok: !result.code, action: op, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "branch_create": {
      const branch = normalizeGitRefName(params?.branch, "branch");
      const startPoint = params?.startPoint ? normalizeGitRefName(params.startPoint, "startPoint") : null;
      const result = await runGit(["branch", branch, ...(startPoint ? [startPoint] : [])], true);
      return { ok: !result.code, action: op, branch, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "branch_checkout": {
      const branch = normalizeGitRefName(params?.branch, "branch");
      const create = Boolean(params?.create);
      const result = await runGit([create ? "checkout" : "switch", ...(create ? ["-b", branch] : [branch])], true);
      return { ok: !result.code, action: op, branch, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "branch_delete": {
      const branch = normalizeGitRefName(params?.branch, "branch");
      const force = Boolean(params?.force);
      const result = await runGit(["branch", force ? "-D" : "-d", branch], true);
      return { ok: !result.code, action: op, branch, force, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "worktree_list": {
      const result = await runGit(["worktree", "list", "--porcelain"], true);
      return { ok: !result.code, action: op, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "worktree_add": {
      const { rel } = resolveSandboxPath(params?.path || "");
      if (!rel) {
        throw new Error("path is required for worktree_add");
      }
      const branch = params?.branch ? normalizeGitRefName(params.branch, "branch") : null;
      const startPoint = params?.startPoint ? normalizeGitRefName(params.startPoint, "startPoint") : null;
      const args = ["worktree", "add"];
      if (branch) {
        args.push("-b", branch);
      }
      args.push(rel);
      if (startPoint) {
        args.push(startPoint);
      }
      const result = await runGit(args, true);
      return { ok: !result.code, action: op, path: rel, branch, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "worktree_remove": {
      const { rel } = resolveSandboxPath(params?.path || "");
      if (!rel) {
        throw new Error("path is required for worktree_remove");
      }
      const force = Boolean(params?.force);
      const result = await runGit(["worktree", "remove", ...(force ? ["--force"] : []), rel], true);
      return { ok: !result.code, action: op, path: rel, force, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    case "worktree_prune": {
      const result = await runGit(["worktree", "prune"], true);
      return { ok: !result.code, action: op, output: `${result.stdout || ""}${result.stderr || ""}`.trim() };
    }
    default:
      throw new Error("Unsupported git action. Use status, log, diff, add, commit, remote_info, pull, push, branch_list, branch_create, branch_checkout, branch_delete, worktree_list, worktree_add, worktree_remove, or worktree_prune.");
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
  const { absolute: baseAbs, rel: baseRel } = resolveSandboxPath(args.path || "");
  const requestedMode = String(args.mode || "hybrid").trim().toLowerCase();
  const result = await searchWorkspaceFiles(getSandboxRoot(), baseAbs, args);
  return {
    ok: true,
    query,
    mode: requestedMode === "full" ? "text" : requestedMode,
    path: baseRel,
    ...result
  };
}

async function runAutomatedTestProfile(args = {}) {
  const profile = String(args.profile || "npm-test").trim().toLowerCase();
  const timeoutMs = Math.max(2000, Math.min(10 * 60 * 1000, Number(args.timeoutMs || 120000)));
  const cwdScope = String(args.cwd || "project").trim().toLowerCase();
  const cwd = ["sandbox", "workspace"].includes(cwdScope) ? getSandboxRoot() : projectRoot;
  const requestedTestPath = String(args.path || "").trim();

  let command = "npm";
  let commandArgs = ["test"];
  if (profile === "node-test") {
    command = "node";
    commandArgs = requestedTestPath
      ? ["--test", resolveSandboxPath(requestedTestPath).rel]
      : ["--test"];
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

async function previewWorkspaceDeployment(args = {}) {
  const action = String(args?.action || "preview").trim().toLowerCase();
  if (action !== "preview") {
    throw new Error("only deployment preview is available; activation requires the privileged helper release");
  }
  const result = previewDeployment(args?.manifest, {
    allowedSuffixes: deploymentAllowedSuffixes,
    allowedRuntimes: deploymentAllowedRuntimes,
    allowedEnvironmentNames: deploymentAllowedEnvironmentNames,
    port: deploymentPreviewPort
  });
  const artifact = resolveSandboxPath(result.manifest.artifactPath);
  const artifactStat = await fsp.stat(artifact.absolute).catch(() => null);
  if (!artifactStat?.isDirectory()) {
    throw new Error("artifactPath must reference an existing workspace directory");
  }
  let entrypoint = null;
  if (result.manifest.entrypoint) {
    entrypoint = resolveSandboxPath(`${result.manifest.artifactPath}/${result.manifest.entrypoint}`);
    const entrypointStat = await fsp.stat(entrypoint.absolute).catch(() => null);
    if (!entrypointStat?.isFile()) {
      throw new Error("entrypoint must reference an existing file inside artifactPath");
    }
  }
  return {
    ...result,
    checks: {
      artifactDirectory: artifact.rel,
      entrypointFile: entrypoint?.rel || null,
      workspace: getWorkspaceContext().code
    }
  };
}

async function readDeploymentApprovalDb() {
  try {
    const parsed = JSON.parse(await fsp.readFile(deploymentApprovalDbPath, "utf8"));
    return { version: 1, approvals: Array.isArray(parsed?.approvals) ? parsed.approvals : [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, approvals: [] };
    throw error;
  }
}

async function writeDeploymentApprovalDb(db) {
  const operation = deploymentApprovalWriteQueue.then(async () => {
    await fsp.mkdir(path.dirname(deploymentApprovalDbPath), { recursive: true });
    const temporaryPath = `${deploymentApprovalDbPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await fsp.writeFile(temporaryPath, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 });
    await fsp.rename(temporaryPath, deploymentApprovalDbPath);
  });
  deploymentApprovalWriteQueue = operation.catch(() => {});
  return operation;
}

async function mutateDeploymentApprovalDb(mutator) {
  const operation = deploymentApprovalMutationQueue.then(async () => {
    const db = await readDeploymentApprovalDb();
    const result = await mutator(db);
    await writeDeploymentApprovalDb(db);
    return result;
  });
  deploymentApprovalMutationQueue = operation.catch(() => {});
  return operation;
}

function findDeploymentApproval(db, id) {
  return db.approvals.find((approval) => approval.id === String(id || "").trim()) || null;
}

function callDeploymentHelper(request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(deploymentHelperSocketPath);
    let response = "";
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("deployment helper timed out")), deploymentHelperTimeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(JSON.stringify(request)));
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.length > 64 * 1024) finish(new Error("deployment helper response is too large"));
    });
    socket.on("end", () => {
      try {
        const result = JSON.parse(response);
        if (!result?.ok) throw new Error(result?.error || "deployment helper rejected activation");
        finish(null, result);
      } catch (error) {
        finish(error);
      }
    });
    socket.on("error", (error) => finish(error));
  });
}

async function executeApprovedWorkspaceDeployment(args = {}, action = "activate") {
  const operation = deploymentActivationQueue.then(async () => {
    const preview = await previewWorkspaceDeployment({ action: "preview", manifest: args?.manifest });
    if (preview.manifest.runtime !== "static") throw new Error("approved deployment actions currently support static runtime only");
    if (preview.manifest.environmentNames.length > 0 || preview.manifest.persistentData) {
      throw new Error("static activation does not support environment names or persistent data");
    }
    const workspaceCode = getWorkspaceContext().code;
    const approvalId = String(args?.approvalId || "").trim();
    const approvalToken = String(args?.approvalToken || "").trim();
    if (!approvalId || !approvalToken) throw new Error(`approvalId and approvalToken are required for ${action}`);
    await mutateDeploymentApprovalDb((db) => {
      const approval = findDeploymentApproval(db, approvalId);
      if (!approval) throw new Error("deployment approval not found");
      const activating = beginDeploymentActivation(approval, {
        token: approvalToken,
        workspaceCode,
        manifest: preview.manifest,
        action
      });
      db.approvals = db.approvals.map((item) => item.id === approval.id ? activating : item);
    });
    const releaseId = action === "activate" ? makeReleaseId(new Date(), randomBytes(6).toString("hex")) : null;
    try {
      const result = await callDeploymentHelper({
        action: action === "rollback" ? "rollback-static" : "activate-static",
        workspaceCode,
        ...(releaseId ? { releaseId } : {}),
        manifest: preview.manifest
      });
      await mutateDeploymentApprovalDb((db) => {
        const approval = findDeploymentApproval(db, approvalId);
        const consumed = completeDeploymentActivation(approval, { releaseId: result.releaseId });
        db.approvals = db.approvals.map((item) => item.id === approval.id ? consumed : item);
      });
      return { ...result, approvalId };
    } catch (error) {
      await mutateDeploymentApprovalDb((db) => {
        const approval = findDeploymentApproval(db, approvalId);
        if (approval?.status === "activating") {
          const failed = failDeploymentActivation(approval, { error: error?.message || error });
          db.approvals = db.approvals.map((item) => item.id === approval.id ? failed : item);
        }
      });
      throw error;
    }
  });
  deploymentActivationQueue = operation.catch(() => {});
  return operation;
}

async function callInternalApiFromAgent(args = {}) {
  const rawPath = String(args.path || "").trim();
  if (!rawPath || !rawPath.startsWith("/api/")) {
    throw new Error("path must start with /api/");
  }
  if (rawPath.startsWith("/api/admin/")) {
    throw new Error("/api/admin endpoints are not available to agent tools");
  }
  if (/^\/api\/chat\/subagents\/[^/]+\/approve(?:\?|$)/.test(rawPath)) {
    throw new Error("coding subagent approval requires an authenticated browser user");
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

async function createNotification(req, message, level = "info", metadata = null) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level: String(level || "info").slice(0, 16),
    message: String(message || "").slice(0, 1000),
    ...(metadata && typeof metadata === "object" ? { metadata: sanitizeAuditPayload(metadata) } : {})
  };
  notificationStore.unshift(entry);
  if (notificationStore.length > 200) {
    notificationStore.length = 200;
  }
  await appendAuditLog(req, "notify", { level: entry.level, message: entry.message });
  return entry;
}

async function requestUserInput(req, args = {}) {
  const jobId = String(req?.chatJobId || "").trim();
  const job = jobId ? chatJobStore.get(jobId) : null;
  if (!job) throw new Error("ask_user is only available during a queued chat job");
  if (job.question) throw new Error("this chat job is already waiting for an answer");
  const prompt = String(args.prompt || args.question || "").trim().slice(0, 2000);
  if (!prompt) throw new Error("prompt is required");
  const choices = [...new Set((Array.isArray(args.choices) ? args.choices : [])
    .map((choice) => String(choice || "").trim().slice(0, 200))
    .filter(Boolean))].slice(0, 12);
  const question = {
    id: `question-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobId,
    prompt,
    choices,
    createdAt: new Date().toISOString(),
    answeredAt: null
  };
  job.question = question;
  recordChatJobEvent(job, "needs-input", { questionId: question.id, prompt, choices });
  await createNotification(req, `Agent question: ${prompt}`, "warning", {
    kind: "user-question",
    jobId,
    questionId: question.id,
    clientChatId: String(job.requestBody?.clientChatId || job.recovery?.clientChatId || "").slice(0, 160),
    choices
  });
  const error = new Error("Waiting for user input");
  error.code = "USER_INPUT_REQUIRED";
  error.question = question;
  throw error;
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

async function runAgentReachCommand(command, args, timeout = agentReachTimeoutMs) {
  const result = await execFileAsync(command, args, {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: agentReachHome,
      AGENT_REACH_LANG: "en",
      PATH: [
        path.dirname(agentReachBin),
        path.dirname(agentReachMcporterBin),
        process.env.PATH || "/usr/local/bin:/usr/bin:/bin"
      ].join(path.delimiter)
    }
  });
  return String(result.stdout || "").trim();
}

function parseAgentReachJson(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

async function getAgentReachStatus() {
  const output = await runAgentReachCommand(agentReachBin, ["doctor", "--json"]);
  const raw = parseAgentReachJson(output, "Agent Reach doctor");
  const channels = Object.fromEntries(Object.entries(raw).map(([id, channel]) => [id, {
    status: String(channel?.status || "unknown"),
    tier: Number.isFinite(Number(channel?.tier)) ? Number(channel.tier) : null,
    activeBackend: channel?.active_backend || null,
    backends: Array.isArray(channel?.backends) ? channel.backends.map((item) => String(item)) : []
  }]));
  const available = Object.values(channels).filter((channel) => channel.status === "ok").length;
  return { summary: { available, total: Object.keys(channels).length }, channels };
}

async function searchInternetWithAgentReach(queryValue, limitValue) {
  const query = String(queryValue || "").trim().slice(0, 500);
  if (!query) {
    throw new Error("query is required");
  }
  const limit = Math.max(1, Math.min(10, Number(limitValue || 5)));
  const output = await runAgentReachCommand(agentReachMcporterBin, [
    "call",
    "exa.web_search_exa",
    `query=${query}`,
    `numResults=${limit}`,
    "--output",
    "json",
    "--timeout",
    String(agentReachTimeoutMs)
  ]);
  return { query, limit, provider: "exa", result: parseAgentReachJson(output, "Exa search") };
}

async function searchImages(queryValue, limitValue) {
  const query = String(queryValue || "").trim().slice(0, 500);
  if (!query) throw new Error("query is required");
  const limit = Math.max(1, Math.min(20, Number(limitValue || 8)));
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: String(limit),
    prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata",
    iiurlwidth: "640",
    format: "json",
    origin: "*"
  }).toString();
  const response = await fetch(url, { headers: { "User-Agent": "remote-ai-access/1.0" } });
  if (!response.ok) throw new Error(`Wikimedia image search failed (${response.status})`);
  return { query, provider: "wikimedia-commons", results: parseWikimediaImageResults(await response.json(), limit) };
}

async function generateWorkspaceImage(args = {}) {
  const request = normalizeImageRequest(args);
  const model = request.model || (request.provider === "xai" ? xaiImageModel : request.provider === "google" ? googleImageModel : openaiImageModel);
  let payload;
  if (request.provider === "openai") {
    if (!client) throw new Error("OpenAI image generation is not configured");
    payload = await client.images.generate({ model, prompt: request.prompt, size: request.size, quality: request.quality });
  } else if (request.provider === "xai") {
    if (!xaiApiKey) throw new Error("xAI image generation is not configured");
    const response = await fetch(`${xaiApiBaseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${xaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: request.prompt, response_format: "b64_json" })
    });
    payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || `xAI image generation failed (${response.status})`);
  } else {
    if (!googleApiKey) throw new Error("Google image generation is not configured");
    const response = await fetch(`${googleNativeApiBaseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(googleApiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: request.prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } })
    });
    payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `Google image generation failed (${response.status})`);
  }
  const generated = extractGeneratedImage(payload);
  let bytes;
  if (generated.base64) {
    bytes = Buffer.from(generated.base64, "base64");
  } else {
    const response = await fetch(generated.url);
    if (!response.ok) throw new Error(`Generated image download failed (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new Error("Generated image size is invalid or exceeds 25 MB");
  const { absolute, rel } = resolveSandboxPath(request.outputPath);
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, bytes, { mode: 0o644 });
  await commitSandboxSnapshot(`generate image ${rel}`);
  return { ok: true, provider: request.provider, model, path: rel, size: bytes.length };
}

async function searchYoutubeWithAgentReach(queryValue, limitValue) {
  const query = String(queryValue || "").trim().slice(0, 300);
  if (!query) {
    throw new Error("query is required");
  }
  const limit = Math.max(1, Math.min(10, Number(limitValue || 5)));
  const output = await runAgentReachCommand(agentReachYtDlpBin, [
    "--flat-playlist",
    "--playlist-end",
    String(limit),
    "--dump-single-json",
    "--no-warnings",
    `ytsearch${limit}:${query}`
  ]);
  const data = parseAgentReachJson(output, "YouTube search");
  const results = (Array.isArray(data?.entries) ? data.entries : []).slice(0, limit).map((item) => ({
    id: String(item?.id || ""),
    title: String(item?.title || ""),
    url: item?.id ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}` : String(item?.url || ""),
    channel: String(item?.channel || item?.uploader || ""),
    duration: Number.isFinite(Number(item?.duration)) ? Number(item.duration) : null
  }));
  return { query, provider: "yt-dlp", results };
}

function assertYoutubeUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("A valid YouTube URL is required");
  }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!new Set(["youtube.com", "youtu.be", "youtube-nocookie.com", "m.youtube.com"]).has(hostname)) {
    throw new Error("Only YouTube URLs are supported");
  }
  return url.toString();
}

function captionTextFromJson(data) {
  return (Array.isArray(data?.events) ? data.events : [])
    .map((event) => (Array.isArray(event?.segs) ? event.segs : []).map((segment) => String(segment?.utf8 || "")).join(""))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function captionTextFromVtt(value) {
  const seen = new Set();
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "WEBVTT" && !/^\d+$/.test(line) && !/-->/.test(line) && !/^Kind:|^Language:/i.test(line))
    .map((line) => stripHtml(line))
    .filter((line) => line && !seen.has(line) && seen.add(line))
    .join("\n");
}

async function getYoutubeTranscriptWithAgentReach(urlValue, languageValue, maxCharsValue) {
  const url = assertYoutubeUrl(urlValue);
  const language = String(languageValue || "en").trim().toLowerCase().slice(0, 20) || "en";
  const maxChars = Math.max(1000, Math.min(100000, Number(maxCharsValue || 30000)));
  const accessArgs = [
    ...(agentReachProxy ? ["--proxy", agentReachProxy] : []),
    ...(agentReachYoutubeCookiesFile ? ["--cookies", path.resolve(agentReachYoutubeCookiesFile)] : [])
  ];
  let output;
  try {
    output = await runAgentReachCommand(agentReachYtDlpBin, [
      "--dump-single-json",
      "--skip-download",
      "--no-warnings",
      ...accessArgs,
      url
    ]);
  } catch (error) {
    const details = String(error?.stderr || error?.message || error);
    if (/not a bot|sign in|cookies/i.test(details)) {
      throw new Error("YouTube blocked transcript access from this server IP. Configure AGENT_REACH_PROXY or a dedicated-account AGENT_REACH_YOUTUBE_COOKIES_FILE.");
    }
    throw error;
  }
  const info = parseAgentReachJson(output, "YouTube metadata");
  const captions = { ...(info?.automatic_captions || {}), ...(info?.subtitles || {}) };
  const languageKey = Object.keys(captions).find((key) => key.toLowerCase() === language)
    || Object.keys(captions).find((key) => key.toLowerCase().startsWith(`${language}-`))
    || Object.keys(captions).find((key) => key.toLowerCase().startsWith("en"));
  const tracks = languageKey ? captions[languageKey] : [];
  const track = (Array.isArray(tracks) ? tracks : []).find((item) => item?.ext === "json3")
    || (Array.isArray(tracks) ? tracks : []).find((item) => item?.ext === "vtt")
    || (Array.isArray(tracks) ? tracks : [])[0];
  if (!track?.url) {
    throw new Error("No transcript is available for this video");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), agentReachTimeoutMs);
  try {
    const response = await fetch(track.url, { signal: controller.signal, headers: info?.http_headers || {} });
    if (!response.ok) {
      throw new Error(`Transcript download failed (${response.status})`);
    }
    const raw = await response.text();
    const transcript = track.ext === "json3"
      ? captionTextFromJson(parseAgentReachJson(raw, "YouTube transcript"))
      : captionTextFromVtt(raw);
    return {
      url,
      id: String(info?.id || ""),
      title: String(info?.title || ""),
      channel: String(info?.channel || info?.uploader || ""),
      language: languageKey,
      transcript: transcript.slice(0, maxChars),
      truncated: transcript.length > maxChars
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeAgentContextScope(value) {
  return String(value || "chat").trim().toLowerCase() === "global" ? "global" : "chat";
}

function normalizeAgentContextEntries(source) {
  return (Array.isArray(source) ? source : []).slice(0, 60).map((entry) => ({
    id: String(entry?.id || "").slice(0, 120),
    label: String(entry?.label || "Untitled context").slice(0, 200),
    content: String(entry?.content || "").slice(0, 12000),
    enabled: entry?.enabled !== false,
    disabledLines: (Array.isArray(entry?.disabledLines) ? entry.disabledLines : [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0)
      .slice(0, 1000)
  }));
}

function getAgentContextState(req) {
  if (!req.agentContextState) {
    req.agentContextState = {
      chat: normalizeAgentContextEntries(req.body?.contextEntries?.chat),
      global: normalizeAgentContextEntries(req.body?.contextEntries?.global)
    };
  }
  return req.agentContextState;
}

function getAgentContextEntries(req, scope) {
  return getAgentContextState(req)[normalizeAgentContextScope(scope)];
}

function findAgentContextEntryIndex(entries, mutation) {
  const id = String(mutation?.id || "").trim();
  const label = String(mutation?.label || "").trim().toLowerCase();
  return entries.findIndex((entry) => (id && entry.id === id)
    || (label && entry.label.toLowerCase() === label));
}

function queueAgentContextMutation(req, mutation) {
  if (!Array.isArray(req.agentContextMutations)) {
    req.agentContextMutations = [];
  }
  if (req.agentContextMutations.length >= 60) {
    throw new Error("context mutation limit reached for this response");
  }
  const scope = normalizeAgentContextScope(mutation?.scope);
  const entries = getAgentContextEntries(req, scope);
  const matchIndex = findAgentContextEntryIndex(entries, mutation);
  if (mutation.action === "add") {
    if (entries.length >= 60) {
      throw new Error("context entry limit reached for this scope");
    }
    entries.push(normalizeAgentContextEntries([mutation])[0]);
  } else if (mutation.action === "update") {
    if (matchIndex < 0) {
      throw new Error("context entry not found");
    }
    const existing = entries[matchIndex];
    entries[matchIndex] = normalizeAgentContextEntries([{
      ...existing,
      label: mutation.newLabel || existing.label,
      content: mutation.content === undefined ? existing.content : mutation.content,
      enabled: mutation.enabled === undefined ? existing.enabled : mutation.enabled
    }])[0];
  } else if (mutation.action === "remove") {
    if (matchIndex < 0) {
      throw new Error("context entry not found");
    }
    entries.splice(matchIndex, 1);
  }
  req.agentContextMutations.push(mutation);
  return mutation;
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
      name: "list_context",
      description: "List persistent context entries available to this chat, from either this chat or all chats.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["chat", "global"], description: "Context scope, default chat" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "add_context",
      description: "Add a persistent context entry for this chat or all chats.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["chat", "global"] },
          label: { type: "string" },
          content: { type: "string" },
          enabled: { type: "boolean" }
        },
        required: ["label", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_context",
      description: "Update a persistent context entry by id or exact label.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["chat", "global"] },
          id: { type: "string" },
          label: { type: "string", description: "Existing exact label when id is omitted" },
          newLabel: { type: "string" },
          content: { type: "string" },
          enabled: { type: "boolean" }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "remove_context",
      description: "Remove a persistent context entry by id or exact label.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["chat", "global"] },
          id: { type: "string" },
          label: { type: "string", description: "Existing exact label when id is omitted" }
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
      name: "agent_reach_status",
      description: "Check which Agent Reach internet channels and backends are currently available.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "search_internet",
      description: "Run a deeper semantic internet search through Agent Reach and Exa.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Result count from 1 to 10" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_youtube",
      description: "Search YouTube videos through Agent Reach and yt-dlp.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Result count from 1 to 10" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_images",
      description: "Search Wikimedia Commons images with source and license metadata.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number" } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image with a configured OpenAI, xAI, or Google image model and save it in the workspace.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          provider: { type: "string", enum: ["openai", "xai", "google"] },
          model: { type: "string" },
          outputPath: { type: "string" },
          size: { type: "string" },
          quality: { type: "string" }
        },
        required: ["prompt", "outputPath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_youtube_transcript",
      description: "Extract available subtitles or automatic captions from a YouTube video.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          language: { type: "string", description: "Preferred caption language, default en" },
          maxChars: { type: "number", description: "Maximum transcript characters, up to 100000" }
        },
        required: ["url"]
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
      description: "Run safe terminal commands. In Docker runtime, command strings run through sh -lc for normal shell syntax including &&, ||, pipes, redirects, and backslashes.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          cwd: { type: "string" },
          dockerImage: { type: "string", description: "Optional allow-listed Docker image to use when TERMINAL_RUNTIME=docker, such as dockcross/windows-static-x64 or mstorsjo/llvm-mingw" },
          timeoutMs: { type: "number" }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_build",
      description: "Run common sandboxed build/debug setup profiles such as cmake, make, ninja, compiler commands, Python venv/pip, and Docker-only apt installs.",
      parameters: {
        type: "object",
        properties: {
          profile: { type: "string", description: "custom|cmake-configure|cmake-build|cmake-test|make|ninja|gcc|g++|cc|c++|python-venv|pip-install|apt-install" },
          command: { type: "string", description: "custom shell command for profile=custom" },
          cwd: { type: "string" },
          sourceDir: { type: "string" },
          buildDir: { type: "string" },
          target: { type: "string" },
          jobs: { type: "number" },
          packages: { type: "array", items: { type: "string" } },
          args: { type: "array", items: { type: "string" } },
          dockerImage: { type: "string", description: "Optional allow-listed Docker image to use when TERMINAL_RUNTIME=docker, such as dockcross/windows-static-x64 or mstorsjo/llvm-mingw" },
          timeoutMs: { type: "number" }
        },
        required: ["profile"]
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
          action: { type: "string", description: "status|log|diff|add|commit|remote_info|pull|push|branch_list|branch_create|branch_checkout|branch_delete|worktree_list|worktree_add|worktree_remove|worktree_prune" },
          path: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
          branch: { type: "string" },
          startPoint: { type: "string" },
          create: { type: "boolean" },
          force: { type: "boolean" },
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
      name: "ask_user",
      description: "Pause this workflow and ask the user a question. The chat job resumes when the user answers.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The question to show the user" },
          choices: { type: "array", items: { type: "string" }, description: "Optional answer choices" }
        },
        required: ["prompt"]
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
  },
  {
    type: "function",
    function: {
      name: "deploy_application",
      description: "Preview a declarative deployment, activate an approved static release, or roll back to its registry-recorded prior release.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["preview", "activate", "rollback"] },
          approvalId: { type: "string" },
          approvalToken: { type: "string" },
          manifest: {
            type: "object",
            properties: {
              application: { type: "string" },
              hostname: { type: "string" },
              runtime: { type: "string", enum: ["static", "node-service"] },
              artifactPath: { type: "string" },
              entrypoint: { type: "string" },
              healthPath: { type: "string" },
              environmentNames: { type: "array", items: { type: "string" } },
              persistentData: { type: "boolean" },
              resources: {
                type: "object",
                properties: {
                  memoryMb: { type: "integer" },
                  cpuQuotaPercent: { type: "integer" },
                  processLimit: { type: "integer" }
                }
              }
            },
            required: ["application", "hostname", "runtime", "artifactPath"]
          }
        },
        required: ["action", "manifest"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "spawn_subagent",
      description: "Start a bounded research, review, image, or approval-gated coding child and return its job ID immediately. For broad work, spawn parallel siblings for independent components or non-overlapping file scopes, then wait for them together.",
      parameters: {
        type: "object",
        properties: {
          idempotencyKey: { type: "string" },
          task: { type: "string" },
          role: { type: "string", enum: ["research", "review", "image", "coding"] },
          provider: { type: "string" },
          model: { type: "string" },
          allowedTools: { type: "array", items: { type: "string" } },
          allowedPaths: { type: "array", items: { type: "string" } },
          tdd: {
            type: "object",
            description: "Optional bounded tests-first repair loop for coding children.",
            properties: {
              testCommand: { type: "string" },
              profile: { type: "string", description: "npm-test|npm-lint|node-test|chat-jobs-smoke" },
              cwd: { type: "string", description: "workspace|sandbox|project" },
              path: { type: "string", description: "explicit test file path, such as tdd-demo/hello.test.mjs" },
              testFile: { type: "string" },
              maxAttempts: { type: "number" },
              timeoutMs: { type: "number" }
            }
          },
          maxSteps: { type: "number" },
          timeoutMs: { type: "number" }
        },
        required: ["idempotencyKey", "task"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_subagent",
      description: "Get a child agent's status, bounded events, and result.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "wait_subagents",
      description: "Wait briefly for one or more child agents to reach a terminal state.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" } },
          timeoutMs: { type: "number" }
        },
        required: ["ids"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "cancel_subagent",
      description: "Cancel a child agent owned by this parent request.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      }
    }
  }
];

function agentToolDefinitionsForRequest(req) {
  const profileDefinitions = filterAgentToolDefinitions(agentToolDefinitions, getAgentToolProfile(req));
  const internalTools = req?.internalAgentAuthorization?.allowedTools;
  return Array.isArray(internalTools)
    ? profileDefinitions.filter((definition) => internalTools.includes(definition?.function?.name))
    : profileDefinitions;
}

function subagentParentId(req) {
  return String(req?.chatJobId || resolveRequestTraceId(req) || "").trim();
}

function publicSubagentJob(job) {
  return {
    id: job.id,
    parentId: job.parentId,
    task: job.task,
    role: job.role,
    provider: job.provider,
    model: job.model,
    status: job.status,
    allowedTools: job.allowedTools,
    allowedPaths: job.allowedPaths || [],
    limits: job.limits ? { maxSteps: job.limits.maxSteps, timeoutMs: job.limits.timeoutMs } : null,
    approvedAt: job.approvedAt || null,
    tdd: job.tdd || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    events: job.events,
    acceptance: job.acceptance || { artifacts: {}, context: {}, updatedAt: null },
    result: job.status === "completed" ? job.result : null,
    error: ["failed", "cancelled"].includes(job.status) ? job.error : null
  };
}

function recordSubagentEvent(job, type, payload = {}) {
  job.events.push({ type, timestamp: new Date().toISOString(), payload: sanitizeAuditPayload(payload) });
  if (job.events.length > SUBAGENT_LIMITS.maxEvents) job.events.splice(0, job.events.length - SUBAGENT_LIMITS.maxEvents);
}

function cancelSubagentJob(job, reason = "Cancelled by parent") {
  if (!job || !["awaiting_approval", "queued", "running"].includes(job.status)) return false;
  job.abortController.abort(new Error(reason));
  clearTimeout(job.timeout);
  job.status = "cancelled";
  job.completedAt = new Date().toISOString();
  job.error = { message: reason, cancelled: true };
  recordSubagentEvent(job, "cancelled", { reason });
  return true;
}

function startSubagentJob(job) {
  if (!job || !["awaiting_approval", "queued"].includes(job.status)) return false;
  job.status = "queued";
  recordSubagentEvent(job, "queued", { role: job.role, provider: job.provider, model: job.model });
  queueMicrotask(() => job.workspaceContextStore.run(job.workspaceContext, async () => {
    if (job.status === "cancelled") return;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    recordSubagentEvent(job, "running", {});
    job.timeout = setTimeout(() => cancelSubagentJob(job, "Subagent runtime limit reached"), job.limits.timeoutMs);
    const profile = ["image", "coding"].includes(job.role) ? "standard" : "read-only";
    const action = job.role === "review" ? "Review" : job.role === "image" ? "Find or create imagery for" : job.role === "coding" ? "Implement" : "Research";
    const pathRule = job.role === "coding" ? ` You may write only these exact approved paths: ${job.allowedPaths.join(", ")}. Leave all changes uncommitted for human review in Git Change Center.` : "";
    const basePrompt = `${action} this focused task and return a concise evidence-based result with sources, files, and tool evidence.${pathRule} Do not mutate persistent context. If useful, propose context separately using an exact fenced block such as \`\`\`raa-context add with scope and label header lines; proposals require parent acceptance.\n\n${job.task}`;
    const childReq = {
      body: {
        provider: job.provider,
        model: job.model,
        agentMode: true,
        toolProfile: profile,
        agentMaxStepsOverride: job.limits.maxSteps,
        messages: [{ role: "user", content: basePrompt }]
      },
      headers: {},
      ip: "internal-subagent",
      traceId: job.id,
      abortSignal: job.abortController.signal,
      internalAgentAuthorization: {
        apiKeyFingerprint: job.apiKeyFingerprint,
        workspaceCode: job.workspaceCode,
        toolProfile: profile,
        allowedTools: job.allowedTools,
        allowedPaths: job.allowedPaths,
        codingApproved: job.role === "coding" && Boolean(job.approvedAt),
        depth: 1
      },
      onJobEvent: (type, payload) => recordSubagentEvent(job, type, payload)
    };
    try {
      let response;
      if (job.tdd) {
        const tddResult = await runTddRepairLoop({
          testCommand: job.tdd.testCommand,
          maxAttempts: job.tdd.maxAttempts,
          testFile: job.tdd.testFile,
          generateAttempt: async ({ feedback }) => {
            childReq.body.messages = [{
              role: "user",
              content: feedback
                ? `${basePrompt}\n\nTDD feedback from the previous attempt:\n${feedback}`
                : `${basePrompt}\n\nTDD requirement: write or update the tests first, then implement the requested change. Do not commit.`
            }];
            const attempt = await generateChatResponse(childReq);
            recordSubagentEvent(job, "tdd-attempt", { attempt: (job.tdd.attempt || 0) + 1 });
            return attempt;
          },
          runTest: async () => runAutomatedTestProfile({
            profile: job.tdd.profile,
            cwd: job.tdd.cwd,
            path: job.tdd.path,
            timeoutMs: job.tdd.timeoutMs
          })
        });
        job.tdd = tddResult.state;
        recordSubagentEvent(job, "tdd-test", {
          status: job.tdd.status,
          attempt: job.tdd.attempt,
          passed: Boolean(tddResult.testResult?.ok),
          exitCode: tddResult.testResult?.exitCode ?? null
        });
        response = tddResult.response;
      } else {
        response = await generateChatResponse(childReq);
      }
      if (job.status !== "cancelled") {
        job.status = "completed";
        job.completedAt = new Date().toISOString();
        job.result = {
          summary: String(response.reply || "").slice(0, SUBAGENT_LIMITS.maxSummaryChars),
          executedTools: Array.isArray(response.executedTools) ? response.executedTools : [],
          evidence: job.events.filter((event) => event.type === "tool-end").slice(-20).map((event) => event.payload),
          usage: { ...normalizeTokenUsage(response.usage), elapsedMs: Date.now() - Date.parse(job.startedAt) }
        };
        if (job.tdd) job.result.tdd = job.tdd;
        job.result.artifacts = collectSubagentArtifacts(job.events);
        job.result.proposedContextMutations = extractSubagentContextProposals(job.result.summary);
        recordSubagentEvent(job, "completed", { executedTools: job.result.executedTools });
      }
    } catch (error) {
      if (job.status !== "cancelled") {
        job.status = "failed";
        job.completedAt = new Date().toISOString();
        job.error = { message: String(error?.message || error).slice(0, 1000) };
        recordSubagentEvent(job, "failed", job.error);
      }
    } finally {
      clearTimeout(job.timeout);
      job.timeout = null;
    }
  }));
  return true;
}

function requireOwnedSubagent(req, id) {
  const job = subagentJobStore.get(String(id || "").trim());
  if (!job) throw Object.assign(new Error("subagent not found"), { status: 404 });
  if (job.parentId !== subagentParentId(req) || job.workspaceCode !== getWorkspaceContext().code) {
    throw Object.assign(new Error("subagent belongs to a different parent or workspace"), { status: 403 });
  }
  return job;
}

async function normalizeCodingWriteScopes(values) {
  const scopes = normalizeSubagentAllowedPaths(values);
  return Promise.all(scopes.map(async (scope) => {
    try {
      const { absolute } = resolveSandboxPath(scope);
      const stat = await fsp.stat(absolute);
      return stat.isDirectory() && !scope.endsWith("/") ? `${scope}/` : scope;
    } catch (error) {
      if (error?.code === "ENOENT") return scope;
      throw error;
    }
  }));
}

function normalizeTddConfig(value, role) {
  if (role !== "coding" || !value || typeof value !== "object") return null;
  const profile = String(value.profile || "npm-test").trim().toLowerCase();
  if (!["npm-test", "npm-lint", "node-test", "chat-jobs-smoke"].includes(profile)) {
    throw new Error("unsupported TDD test profile");
  }
  return {
    testCommand: String(value.testCommand || profile).trim().slice(0, 500),
    profile,
    cwd: ["workspace", "sandbox", "project"].includes(String(value.cwd || "workspace").trim().toLowerCase())
      ? String(value.cwd || "workspace").trim().toLowerCase()
      : "workspace",
    path: String(value.path || "").trim().replace(/\\/g, "/").slice(0, 500) || null,
    testFile: String(value.testFile || "").trim().slice(0, 500) || null,
    maxAttempts: Math.max(1, Math.min(8, Number(value.maxAttempts || 3))),
    timeoutMs: Math.max(2_000, Math.min(10 * 60 * 1000, Number(value.timeoutMs || 120_000)))
  };
}

async function spawnResearchSubagent(req, args) {
  if (req?.internalAgentAuthorization) throw Object.assign(new Error("subagents cannot spawn children"), { status: 403 });
  const parentId = subagentParentId(req);
  if (!parentId) throw new Error("parent request identity is unavailable");
  const idempotencyKey = String(args?.idempotencyKey || "").trim().slice(0, 160);
  const task = String(args?.task || "").trim().slice(0, chatMessageMaxChars);
  const role = normalizeSubagentRole(args?.role);
  if (!idempotencyKey || !task) throw new Error("idempotencyKey and task are required");
  if (!role) throw new Error("subagent role must be research, review, image, or coding");
  const existing = [...subagentJobStore.values()].find((job) => job.parentId === parentId && job.idempotencyKey === idempotencyKey);
  if (existing) return publicSubagentJob(existing);
  const siblings = [...subagentJobStore.values()].filter((job) => job.parentId === parentId);
  if (siblings.length >= SUBAGENT_LIMITS.maxChildrenPerParent) throw Object.assign(new Error("subagent limit reached for this parent"), { status: 429 });
  if (siblings.filter((job) => ["queued", "running"].includes(job.status)).length >= SUBAGENT_LIMITS.maxConcurrentPerParent) {
    throw Object.assign(new Error("concurrent subagent limit reached for this parent"), { status: 429 });
  }

  const parentTools = agentToolDefinitionsForRequest(req).map((definition) => definition.function.name);
  const allowedTools = resolveSubagentAllowedTools({ role, requestedTools: args?.allowedTools, parentTools });
  if (allowedTools.length === 0) throw new Error(`no requested ${role} tools are allowed by the parent profile`);
  const allowedPaths = role === "coding" ? await normalizeCodingWriteScopes(args?.allowedPaths) : [];
  if (role === "coding" && (!allowedTools.includes("write_file") || allowedPaths.length === 0)) {
    throw new Error("coding subagents require parent-approved write_file and at least one exact allowed path");
  }
  const limits = normalizeSubagentLimits(args, role);
  const security = getEffectiveSecuritySettingsSync();
  const providedKey = String(req?.headers?.[security.apiKeyHeaderName] || "").trim();
  if (!providedKey) throw Object.assign(new Error("API key required for subagents"), { status: 401 });
  const provider = String(args?.provider || req.body?.provider || defaultProvider).trim().toLowerCase();
  const model = String(args?.model || req.body?.model || "").trim();
  const tdd = normalizeTddConfig(args?.tdd, role);
  const id = `subagent-${Date.now()}-${subagentJobCounter++}`;
  const abortController = new AbortController();
  const workspaceCode = getWorkspaceContext().code;
  const job = {
    id, parentId, idempotencyKey, task, role, provider, model, workspaceCode, allowedTools, allowedPaths,
    status: role === "coding" ? "awaiting_approval" : "queued", createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
    approvedAt: null, tdd, events: [], result: null, error: null, acceptance: { artifacts: {}, context: {}, updatedAt: null }, abortController, timeout: null,
    limits, apiKeyFingerprint: createHash("sha256").update(providedKey).digest("hex"), workspaceContext: getWorkspaceContext(), workspaceContextStore
  };
  if (role === "coding") recordSubagentEvent(job, "awaiting-approval", { allowedTools, allowedPaths });
  subagentJobStore.set(id, job);
  if (role !== "coding") startSubagentJob(job);
  await appendAuditLog(req, "subagent-spawn", { id, parentId, role, provider, model, allowedTools, maxSteps: limits.maxSteps, timeoutMs: limits.timeoutMs });
  return publicSubagentJob(job);
}

async function executeAgentTool(req, callName, args) {
  assertAgentToolAuthorized(req);
  assertAgentToolAllowed(req, callName);
  switch (callName) {
    case "list_tools": {
      const result = {
        tools: agentToolDefinitionsForRequest(req).map((tool) => ({
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
          { method: "POST", path: "/api/chat", purpose: "Chat endpoint (supports OpenAI, Copilot, Google, xAI, DeepSeek, Anthropic Claude, Together AI, and OpenRouter; agentMode is available on configured OpenAI-compatible providers)" },
          { method: "GET", path: "/api/activity?limit=...", purpose: "Unified workspace activity timeline" },
          { method: "POST", path: "/api/chat/subagents/:id/approve", purpose: "Approve and start a pending coding child" },
          { method: "POST", path: "/api/chat/subagents/:id/tdd-approve", purpose: "Approve a passing TDD child for human Git commit" },
          { method: "PATCH", path: "/api/chat/subagents/:id/acceptance", purpose: "Accept or reject declared child artifacts and context proposals" },
          { method: "GET", path: "/api/tools", purpose: "Tool catalog and capabilities" },
          { method: "GET", path: "/api/notifications?limit=...", purpose: "Recent notify_user entries" },
          { method: "GET", path: "/api/files/list?path=...", purpose: "List directory" },
          { method: "GET", path: "/api/files/read?path=...", purpose: "Read file" },
          { method: "POST", path: "/api/files/write", purpose: "Write file" },
          { method: "POST", path: "/api/files/upload", purpose: "Upload file(s)" },
          { method: "GET", path: "/api/files/download?path=...", purpose: "Download file or directory zip" },
          { method: "GET", path: "/api/files/shares", purpose: "List shares with views, downloads, last access, and expiry status" },
          { method: "PATCH", path: "/api/files/shares/:id/expiration", purpose: "Extend a share expiration" },
          { method: "POST", path: "/api/files/copy", purpose: "Duplicate path" },
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
    case "list_context": {
      const scope = normalizeAgentContextScope(args?.scope);
      const entries = getAgentContextEntries(req, scope);
      await appendAuditLog(req, "agent-tool", { name: callName, scope, count: entries.length });
      return { ok: true, scope, entries };
    }
    case "add_context": {
      const scope = normalizeAgentContextScope(args?.scope);
      const label = String(args?.label || "").trim().slice(0, 200);
      const content = String(args?.content || "").trim().slice(0, 12000);
      if (!label || !content) {
        throw new Error("label and content are required");
      }
      const mutation = queueAgentContextMutation(req, {
        action: "add",
        scope,
        id: `ctx-${randomBytes(8).toString("hex")}`,
        label,
        content,
        enabled: args?.enabled !== false
      });
      await appendAuditLog(req, "agent-tool", { name: callName, scope, label });
      return { ok: true, mutation };
    }
    case "update_context": {
      const scope = normalizeAgentContextScope(args?.scope);
      const id = String(args?.id || "").trim().slice(0, 120);
      const label = String(args?.label || "").trim().slice(0, 200);
      if (!id && !label) {
        throw new Error("id or label is required");
      }
      const mutation = queueAgentContextMutation(req, {
        action: "update",
        scope,
        id,
        label,
        newLabel: typeof args?.newLabel === "string" ? args.newLabel.trim().slice(0, 200) : undefined,
        content: typeof args?.content === "string" ? args.content.slice(0, 12000) : undefined,
        enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined
      });
      await appendAuditLog(req, "agent-tool", { name: callName, scope, id: id || null, label: label || null });
      return { ok: true, mutation };
    }
    case "remove_context": {
      const scope = normalizeAgentContextScope(args?.scope);
      const id = String(args?.id || "").trim().slice(0, 120);
      const label = String(args?.label || "").trim().slice(0, 200);
      if (!id && !label) {
        throw new Error("id or label is required");
      }
      const mutation = queueAgentContextMutation(req, { action: "remove", scope, id, label });
      await appendAuditLog(req, "agent-tool", { name: callName, scope, id: id || null, label: label || null });
      return { ok: true, mutation };
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
      const codingAuthorization = req?.internalAgentAuthorization?.codingApproved;
      if (req?.internalAgentAuthorization?.depth === 1 && !codingAuthorization) {
        throw Object.assign(new Error("child writes require an approved coding subagent"), { status: 403 });
      }
      if (codingAuthorization && !isSubagentWritePathAllowed(args?.path, req.internalAgentAuthorization.allowedPaths)) {
        throw Object.assign(new Error("write path is outside this coding subagent's approved paths"), { status: 403 });
      }
      const result = await writeTextFile(args?.path || "", args?.content || "", { snapshot: !codingAuthorization });
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
    case "agent_reach_status": {
      const result = await getAgentReachStatus();
      await appendAuditLog(req, "agent-tool", { name: callName, channelCount: result.summary.total, available: result.summary.available });
      return result;
    }
    case "search_internet": {
      const result = await searchInternetWithAgentReach(args?.query, args?.limit);
      await appendAuditLog(req, "agent-tool", { name: callName, query: result.query, limit: result.limit, provider: result.provider });
      return result;
    }
    case "search_images": {
      const result = await searchImages(args?.query, args?.limit);
      await appendAuditLog(req, "agent-tool", { name: callName, query: result.query, resultCount: result.results.length, provider: result.provider });
      return result;
    }
    case "generate_image": {
      const result = await generateWorkspaceImage(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, provider: result.provider, model: result.model, path: result.path, size: result.size });
      return result;
    }
    case "search_youtube": {
      const result = await searchYoutubeWithAgentReach(args?.query, args?.limit);
      await appendAuditLog(req, "agent-tool", { name: callName, query: result.query, resultCount: result.results.length });
      return result;
    }
    case "get_youtube_transcript": {
      const result = await getYoutubeTranscriptWithAgentReach(args?.url, args?.language, args?.maxChars);
      await appendAuditLog(req, "agent-tool", { name: callName, videoId: result.id, language: result.language, truncated: result.truncated });
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
      const result = await runSafeTerminalCommand(args?.command, args?.args, args?.cwd, args?.timeoutMs, { dockerImage: args?.dockerImage });
      await appendAuditLog(req, "agent-tool", { name: callName, command: result.command, ok: result.ok, cwd: result.cwd, dockerImage: result.dockerImage || null });
      return result;
    }
    case "run_build": {
      const result = await runBuildTool(args || {});
      await appendAuditLog(req, "agent-tool", { name: callName, profile: result.profile, command: result.buildCommand, ok: result.ok, cwd: result.cwd, dockerImage: result.dockerImage || null });
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
    case "deploy_application": {
      const action = String(args?.action || "preview").trim().toLowerCase();
      const result = action === "preview"
        ? await previewWorkspaceDeployment(args || {})
        : ["activate", "rollback"].includes(action)
          ? await executeApprovedWorkspaceDeployment(args || {}, action)
          : (() => { throw new Error("action must be preview, activate, or rollback"); })();
      await appendAuditLog(req, action === "preview" ? "deployment-preview" : `deployment-${action}`, {
        name: callName,
        action,
        application: result.manifest?.application || result.application,
        hostname: result.manifest?.hostname || result.hostname,
        runtime: result.manifest?.runtime || "static",
        artifactPath: result.manifest?.artifactPath || null,
        environmentNames: result.manifest?.environmentNames || [],
        releaseId: result.releaseId || null,
        approvalId: result.approvalId || null
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
    case "ask_user":
      return requestUserInput(req, args);
    case "spawn_subagent":
      return { ok: true, job: await spawnResearchSubagent(req, args) };
    case "get_subagent":
      return { ok: true, job: publicSubagentJob(requireOwnedSubagent(req, args?.id)) };
    case "wait_subagents": {
      const ids = [...new Set((Array.isArray(args?.ids) ? args.ids : []).map((id) => String(id || "").trim()).filter(Boolean))].slice(0, SUBAGENT_LIMITS.maxChildrenPerParent);
      if (ids.length === 0) throw new Error("ids is required");
      const jobs = ids.map((id) => requireOwnedSubagent(req, id));
      const timeoutMs = Math.max(0, Math.min(60_000, Number(args?.timeoutMs || 30_000)));
      const deadline = Date.now() + timeoutMs;
      while (jobs.some((job) => ["awaiting_approval", "queued", "running"].includes(job.status)) && Date.now() < deadline) {
        assertNotAborted(req);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { ok: true, jobs: jobs.map(publicSubagentJob) };
    }
    case "cancel_subagent": {
      const job = requireOwnedSubagent(req, args?.id);
      cancelSubagentJob(job);
      await appendAuditLog(req, "subagent-cancel", { id: job.id, parentId: job.parentId });
      return { ok: true, job: publicSubagentJob(job) };
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

  if (req?.internalAgentAuthorization?.depth === 1) {
    if (requested > SUBAGENT_LIMITS.maxSteps) inputError(`subagent maxSteps exceeds limit (${SUBAGENT_LIMITS.maxSteps})`);
    return { maxSteps: requested, override: requested > agentMaxSteps };
  }

  const security = getEffectiveSecuritySettingsSync();
  const overrideCode = security.workspaceAgentStepOverrideCodes.get(getWorkspaceContext().code)
    || security.agentMaxStepsOverrideCode;

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

  if (!matchesUnlockCode(providedCode, overrideCode)) {
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
  let usage = normalizeTokenUsage();
  const availableTools = agentToolDefinitionsForRequest(req);
  const traceId = resolveRequestTraceId(req) || createTraceId();
  const latestUserText = [...messages]
    .reverse()
    .find((item) => item.role === "user")?.content || "";
  const likelyToolIntent = /\b(create|write|edit|update|delete|remove|rename|move|read|list|file|folder|directory|search|fetch|format|lint|zip|unzip|git|api|permission|schedule|notify|snapshot|restore|rollback|revert|diff|merge|test|testing|suite)\b/i.test(latestUserText);
  let nudgedForToolUse = false;
  const conversation = [
    {
      role: "system",
      content: "You are a coding agent. If the user asks for file operations, web/API fetches, git operations, conversions, scheduling, or notifications, you must call the appropriate tool first and then summarize the real result. When spawn_subagent is available and work divides into independent components, delegate focused sibling tasks in parallel; give coding siblings non-overlapping file or directory scopes, wait for their results, and integrate the evidence. Never simulate tool calls or describe hypothetical actions as completed."
    },
    ...messages.map((item) => ({ role: item.role, content: item.content }))
  ];

  for (let step = 0; step < maxSteps; step += 1) {
    assertNotAborted(req);
    emitJobProgress(req, "agent-step", { step: step + 1, maxSteps, provider: "openai", traceId });
    const completion = await client.chat.completions.create({
      model,
      messages: conversation,
      tools: availableTools,
      tool_choice: "auto",
      ...(model.startsWith("gpt-5.6-") ? { reasoning_effort: "none" } : {})
    });
    usage = addTokenUsage(usage, completion.usage);

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
          if (error?.code === "USER_INPUT_REQUIRED") throw error;
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

    return { text: assistant.content || "", executedTools, usage };
  }

  try {
    conversation.push({
      role: "system",
      content: "Tool execution budget has been reached. Do not call tools. Provide a concise final answer summarizing completed actions, outputs, and any remaining blockers."
    });

    const finalize = await client.chat.completions.create({
      model,
      messages: conversation,
      tools: availableTools,
      tool_choice: "none",
      ...(model.startsWith("gpt-5.6-") ? { reasoning_effort: "none" } : {})
    });
    usage = addTokenUsage(usage, finalize.usage);
    const finalAssistant = finalize.choices?.[0]?.message;
    const finalText = String(finalAssistant?.content || "").trim();
    if (finalText) {
      return { text: finalText, executedTools, usage };
    }
  } catch {
    // Fall through to deterministic fallback message.
  }

  const count = executedTools.length;
  return {
    text: count > 0
      ? `Agent step limit reached after executing ${count} tool call(s). Please ask me to continue from current state.`
      : "Reached agent step limit before producing a final answer.",
    executedTools,
    usage
  };
}

async function createOpenAiCompatibleChatCompletion(provider, model, conversation, options = {}) {
  const config = compatibleProviderConfigs[provider];
  if (!config) {
    throw new Error(`Provider '${provider}' is not OpenAI-compatible`);
  }
  const payload = {
    model,
    messages: conversation,
    ...options
  };
  const abortSignal = options.abortSignal;
  if (Object.prototype.hasOwnProperty.call(payload, "abortSignal")) {
    delete payload.abortSignal;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "headers")) {
    delete payload.headers;
  }

  return createCompatibleProviderCompletion(config.label, `${config.apiBaseUrl}/chat/completions`, config.apiKey, payload, abortSignal, {
    headers: {
      ...(config.headers || {}),
      ...(options.headers || {})
    }
  });
}

async function createXaiChatCompletion(model, conversation, options = {}) {
  return createOpenAiCompatibleChatCompletion("xai", model, conversation, options);
}

function providerRetryDelay(delayMs, abortSignal) {
  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(abortSignal.reason || new Error("Provider request cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(abortSignal.reason || new Error("Provider request cancelled"));
    };
    const timer = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function createCompatibleProviderCompletion(providerLabel, url, apiKey, payload, abortSignal, options = {}) {
  for (let attempt = 0; attempt <= providerMaxRetries; attempt += 1) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error(`${providerLabel} request timed out`)), providerRequestTimeoutMs);
    const onAbort = () => timeoutController.abort(abortSignal.reason || new Error("Provider request cancelled"));
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    let response;
    let rawBody;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.authorization === false || !apiKey ? {} : { "Authorization": `Bearer ${apiKey}` }),
          ...(options.headers || {})
        },
        signal: timeoutController.signal,
        body: JSON.stringify(payload)
      });
      rawBody = await response.text();
    } catch (error) {
      if (abortSignal?.aborted || attempt >= providerMaxRetries) throw error;
      const delayMs = providerRetryDelayMs({ attempt, baseDelayMs: providerRetryBaseMs, maxDelayMs: providerRetryMaxMs });
      await providerRetryDelay(delayMs, abortSignal);
      continue;
    } finally {
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", onAbort);
    }

    const data = (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return {};
      }
    })();

    if (response.ok) return data;
    if (attempt < providerMaxRetries && isRetryableProviderStatus(response.status)) {
      const delayMs = providerRetryDelayMs({
        attempt,
        retryAfter: response.headers.get("retry-after"),
        baseDelayMs: providerRetryBaseMs,
        maxDelayMs: providerRetryMaxMs
      });
      await providerRetryDelay(delayMs, abortSignal);
      continue;
    }

    const details = data?.error?.message || data?.message || rawBody || `HTTP ${response.status}`;
    const error = new Error(`${providerLabel} request failed: ${details}`);
    error.status = response.status;
    throw error;
  }
  throw new Error(`${providerLabel} request failed after retries`);
}

async function createGoogleChatCompletion(model, conversation, options = {}) {
  return createOpenAiCompatibleChatCompletion("google", model, conversation, options);
}

async function createAnthropicMessage(model, conversation, options = {}) {
  const systemMessages = conversation
    .filter((item) => item.role === "system")
    .map((item) => item.content)
    .filter(Boolean)
    .join("\n\n");
  const messages = conversation
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({ role: item.role, content: item.content }));
  return createCompatibleProviderCompletion("Anthropic Claude", `${anthropicApiBaseUrl}/messages`, anthropicApiKey, {
    model,
    max_tokens: anthropicMaxTokens,
    ...(systemMessages ? { system: systemMessages } : {}),
    messages
  }, options.abortSignal, {
    authorization: false,
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": anthropicVersion
    }
  });
}

async function runCompatibleAgentWithTools(req, provider, model, messages, maxSteps = agentMaxSteps, reasoningEffort = null) {
  const executedTools = [];
  let usage = normalizeTokenUsage();
  const availableTools = agentToolDefinitionsForRequest(req);
  const traceId = resolveRequestTraceId(req) || createTraceId();
  const createCompletion = provider === "google"
    ? createGoogleChatCompletion
    : provider === "xai" ? createXaiChatCompletion : (completionModel, providerConversation, options) => createOpenAiCompatibleChatCompletion(provider, completionModel, providerConversation, options);
  const latestUserText = [...messages]
    .reverse()
    .find((item) => item.role === "user")?.content || "";
  const likelyToolIntent = /\b(create|write|edit|update|delete|remove|rename|move|read|list|file|folder|directory|search|fetch|format|lint|zip|unzip|git|api|permission|schedule|notify|snapshot|restore|rollback|revert|diff|merge|test|testing|suite)\b/i.test(latestUserText);
  let nudgedForToolUse = false;
  const conversation = [
    {
      role: "system",
      content: "You are a coding agent. If the user asks for file operations, web/API fetches, git operations, conversions, scheduling, or notifications, you must call the appropriate tool first and then summarize the real result. When spawn_subagent is available and work divides into independent components, delegate focused sibling tasks in parallel; give coding siblings non-overlapping file or directory scopes, wait for their results, and integrate the evidence. Never simulate tool calls or describe hypothetical actions as completed."
    },
    ...messages.map((item) => ({ role: item.role, content: item.content }))
  ];
  const protectedConversationCount = conversation.length;

  for (let step = 0; step < maxSteps; step += 1) {
    assertNotAborted(req);
    emitJobProgress(req, "agent-step", { step: step + 1, maxSteps, provider, traceId });
    const providerConversation = buildBoundedAgentConversation(conversation, protectedConversationCount, compatibleAgentContextMaxChars);
    const completion = await createCompletion(model, providerConversation, {
      tools: availableTools,
      ...(provider === "deepseek" ? {} : { tool_choice: "auto" }),
      abortSignal: req?.abortSignal,
      ...(compatibleProviderConfigs[provider]?.supportsReasoningEffort && reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    });
    usage = addTokenUsage(usage, completion?.usage);

    const assistant = completion?.choices?.[0]?.message;
    if (!assistant) {
      break;
    }

    if (Array.isArray(assistant.tool_calls) && assistant.tool_calls.length > 0) {
      conversation.push({
        role: "assistant",
        content: assistant.content || "",
        ...(provider === "deepseek" && Object.prototype.hasOwnProperty.call(assistant, "reasoning_content")
          ? { reasoning_content: assistant.reasoning_content }
          : {}),
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
          provider,
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
          provider,
          name: String(name || ""),
          ok,
          durationMs,
          output: sanitizeAuditPayload(output),
          traceId
        });

        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: serializeBoundedToolOutput(output, compatibleAgentToolOutputMaxChars)
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

    return { text: assistant.content || "", executedTools, usage };
  }

  try {
    conversation.push({
      role: "system",
      content: "Tool execution budget has been reached. Do not call tools. Provide a concise final answer summarizing completed actions, outputs, and any remaining blockers."
    });

    const finalize = await createCompletion(model, conversation, {
      ...(provider === "deepseek" ? {} : { tools: availableTools, tool_choice: "none" }),
      abortSignal: req?.abortSignal,
      ...(compatibleProviderConfigs[provider]?.supportsReasoningEffort && reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
    });
    usage = addTokenUsage(usage, finalize?.usage);
    const finalAssistant = finalize?.choices?.[0]?.message;
    const finalText = String(finalAssistant?.content || "").trim();
    if (finalText) {
      return { text: finalText, executedTools, usage };
    }
  } catch {
    // Fall through to deterministic fallback message.
  }

  const count = executedTools.length;
  return {
    text: count > 0
      ? `Agent step limit reached after executing ${count} tool call(s). Please ask me to continue from current state.`
      : "Reached agent step limit before producing a final answer.",
    executedTools,
    usage
  };
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://esm.sh"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", appBaseUrl, "https://esm.sh"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));

app.use("/api/chat/archive", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

app.use((req, res, next) => {
  const traceId = createTraceId();
  req.traceId = traceId;
  res.setHeader("x-trace-id", traceId);
  next();
});

app.use((req, res, next) => {
  next();
});

const publicFileShareLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/share/:token", publicFileShareLimiter, async (req, res) => {
  try {
    const found = await findActiveFileShare(req.params.token);
    if (!found) return res.status(404).send("Share not found or expired.");
    recordShareActivity(found.share, "view");
    await writeFileShareDb(found.db);
    const visibleShare = isFileShareUnlocked(req, found.share)
      ? { ...found.share, passwordHash: "" }
      : found.share;
    return res.type("html").send(renderFileSharePage(req.params.token, visibleShare));
  } catch {
    return res.status(404).send("Share not found or unavailable.");
  }
});

app.post("/share/:token/unlock", publicFileShareLimiter, async (req, res) => {
  try {
    const found = await findActiveFileShare(req.params.token);
    if (!found?.share?.passwordHash) return res.status(404).send("Share not found or expired.");
    const candidate = await scryptBuffer(String(req.body?.password || ""), Buffer.from(found.share.passwordSalt, "hex"));
    const expected = Buffer.from(found.share.passwordHash, "hex");
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      return res.status(401).type("html").send(renderFileSharePage(req.params.token, found.share, { error: "Incorrect password." }));
    }
    res.cookie(fileShareUnlockCookieName(found.share), fileShareUnlockValue(found.share), {
      httpOnly: true,
      sameSite: "lax",
      secure: appBaseUrl.startsWith("https://"),
      maxAge: Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Date.parse(found.share.expiresAt) - Date.now()))
    });
    return res.redirect(303, `/share/${encodeURIComponent(req.params.token)}`);
  } catch {
    return res.status(400).send("Unable to unlock share.");
  }
});

app.get("/share/:token/content", publicFileShareLimiter, async (req, res) => {
  try {
    const found = await findActiveFileShare(req.params.token);
    if (!found) return res.status(404).send("Share not found or expired.");
    if (!isFileShareUnlocked(req, found.share)) return res.status(401).send("Open the share page and enter its password first.");
    if (!found.share.encrypted && shouldTranscodeVideo(found.share.fileName)) {
      const absolute = resolveSharedSourcePath(found.share);
      const stat = await fsp.stat(absolute);
      const preview = await getCachedVideoPreview(
        absolute,
        found.share.fileName,
        `share\0${found.share.workspaceCode}\0${found.share.relativePath}\0${stat.size}\0${stat.mtimeMs}`,
        { waitForReady: false }
      );
      if (preview.preparing) {
        res.setHeader("Retry-After", "2");
        return res.status(202).end();
      }
    }
    found.share.accessCount = Number(found.share.accessCount || 0) + 1;
    found.share.lastAccessedAt = new Date().toISOString();
    if (req.method === "GET" && !req.headers.range) recordShareActivity(found.share, "download");
    await writeFileShareDb(found.db);
    return await streamFileShare(req, res, found.share);
  } catch (error) {
    if (!res.headersSent) return res.status(404).send("Shared file is unavailable.");
    res.destroy(error);
  }
});

app.get("/share-media.js", publicFileShareLimiter, (_req, res) => {
  res.type("text/javascript");
  return res.sendFile(path.join(publicDir, "share-media.js"));
});

const authEnabled = String(process.env.ENABLE_BASIC_AUTH).toLowerCase() === "true";
const authUser = process.env.BASIC_AUTH_USER || "";
const authPass = process.env.BASIC_AUTH_PASS || "";
const basicAuthSessionSecret = String(process.env.BASIC_AUTH_SESSION_SECRET || createHash("sha256").update(`${authUser}\0${authPass}\0remote-ai-access-session`).digest("hex"));
const basicAuthSessionTtlMs = Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Number(process.env.BASIC_AUTH_SESSION_TTL_MS || 12 * 60 * 60 * 1000)));
const basicAuthLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false
});

function basicAuthCredentialsMatch(username, password) {
  const providedUser = Buffer.from(String(username || ""));
  const expectedUser = Buffer.from(authUser);
  const providedPass = Buffer.from(String(password || ""));
  const expectedPass = Buffer.from(authPass);
  const userMatches = providedUser.length === expectedUser.length && timingSafeEqual(providedUser, expectedUser);
  const passMatches = providedPass.length === expectedPass.length && timingSafeEqual(providedPass, expectedPass);
  return userMatches && passMatches;
}

function hasBasicAuthSession(req) {
  const token = parseCookieHeader(req.headers.cookie || "")[BASIC_AUTH_SESSION_COOKIE];
  return verifyBasicAuthSession(token, { username: authUser, secret: basicAuthSessionSecret });
}

function chatArchiveSubject(req) {
  if (authEnabled && authUser) return `basic-auth:${authUser}`;
  if (hasValidApiKey(req)) return "api-key";
  return "local";
}

function chatArchiveProfile(req) {
  const raw = req.method === "GET" ? req.query?.profile : req.body?.profile;
  const profile = String(raw || "default").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(profile)) {
    throw new Error("archive profile must start with a letter or number and contain only letters, numbers, spaces, dots, underscores, or hyphens");
  }
  return profile;
}

function chatArchiveSubjectForProfile(req, profile) {
  const subject = chatArchiveSubject(req);
  return profile === "default" ? subject : `${subject}:profile:${profile}`;
}

function designWorkspaceSlug(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug) throw new Error("workspace name is required");
  return slug;
}

function designWorkspaceText(value, field, maxChars = 200_000) {
  const text = String(value || "").trim();
  if (text.length > maxChars) throw new Error(`${field} exceeds ${maxChars} characters`);
  return text;
}

function basicAuthCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(req.secure || configuredAppBaseUrl.startsWith("https://")),
    path: "/",
    maxAge: basicAuthSessionTtlMs
  };
}

function escapeBasicAuthHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderBasicAuthPage({ nextPath = "/", error = "", authenticated = false } = {}) {
  const safeNext = normalizeBasicAuthReturnPath(nextPath);
  const escapedNext = escapeBasicAuthHtml(safeNext);
  const errorMarkup = error ? `<p class="login-error" role="alert">${escapeBasicAuthHtml(error)}</p>` : "";
  const formMarkup = authenticated
    ? `<p class="login-status">Signed in with the browser session.</p><a class="login-button" href="${escapedNext}">Continue</a><form method="post" action="/basic-auth/logout"><button class="login-link" type="submit">Sign out</button></form>`
    : `${errorMarkup}<form method="post" action="/basic-auth"><input type="hidden" name="next" value="${escapedNext}"><label>Username<input name="username" type="text" autocomplete="username" required autofocus></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="login-button" type="submit">Sign in</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in | Remote AI Access</title><style>:root{color-scheme:light dark;--bg:#eef3ed;--panel:#fff;--ink:#14231c;--muted:#5d6f65;--line:#c9d5cd;--accent:#16734a;--danger:#ad3329}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(145deg,#e7efe9,#f7f4eb);color:var(--ink);font-family:"Segoe UI",sans-serif}.login-shell{width:min(100%,420px);border:1px solid var(--line);border-top:5px solid var(--accent);background:var(--panel);padding:28px;box-shadow:0 18px 50px rgba(20,35,28,.13)}h1{margin:0 0 8px;font-size:1.8rem;letter-spacing:0}p{color:var(--muted);line-height:1.5}form{display:grid;gap:16px;margin-top:22px}label{display:grid;gap:6px;font-weight:650}input{width:100%;min-height:44px;border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:9px 11px;font:inherit}.login-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;border:0;background:var(--accent);color:#fff;padding:10px 18px;font:700 1rem/1 inherit;text-decoration:none;cursor:pointer}.login-link{border:0;background:none;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit}.login-error{color:var(--danger);font-weight:650}.login-status{color:var(--accent);font-weight:650}@media(prefers-color-scheme:dark){:root{--bg:#101813;--panel:#17231c;--ink:#edf5f0;--muted:#a9b9af;--line:#405047;--accent:#51b984}body{background:linear-gradient(145deg,#101813,#20231d)}}</style></head><body><main class="login-shell"><h1>Remote AI Access</h1><p>Sign in with the same credentials used by HTTP Basic Auth.</p>${formMarkup}</main></body></html>`;
}

app.get("/basic-auth", (req, res) => {
  if (!authEnabled) return res.redirect(303, "/");
  const nextPath = normalizeBasicAuthReturnPath(req.query?.next);
  return res.type("html").send(renderBasicAuthPage({ nextPath, authenticated: hasBasicAuthSession(req) }));
});

app.post("/basic-auth", basicAuthLoginLimiter, (req, res) => {
  if (!authEnabled) return res.redirect(303, "/");
  const nextPath = normalizeBasicAuthReturnPath(req.body?.next);
  if (!basicAuthCredentialsMatch(req.body?.username, req.body?.password)) {
    return res.status(401).type("html").send(renderBasicAuthPage({ nextPath, error: "Invalid username or password." }));
  }
  const token = createBasicAuthSession({ username: authUser, secret: basicAuthSessionSecret, ttlMs: basicAuthSessionTtlMs });
  res.cookie(BASIC_AUTH_SESSION_COOKIE, token, basicAuthCookieOptions(req));
  return res.redirect(303, nextPath);
});

app.post("/basic-auth/logout", (req, res) => {
  res.clearCookie(BASIC_AUTH_SESSION_COOKIE, { ...basicAuthCookieOptions(req), maxAge: undefined });
  return res.redirect(303, "/basic-auth");
});

if (authEnabled) {
  app.use((req, res, next) => {
    if (hasBasicAuthSession(req)) {
      req.basicAuthAuthenticated = true;
      return next();
    }
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

    if (!basicAuthCredentialsMatch(user, pass)) {
      return res.status(401).send("Invalid credentials.");
    }

    req.basicAuthAuthenticated = true;
    next();
  });
}

app.use(
  "/api",
  rateLimit({
    windowMs: apiRateLimitWindowMs,
    max: apiRateLimitMax,
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

  if (!hasValidApiKey(req, security) && !hasValidBrowserFileSession(req, pathname)) {
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
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const origin = String(req.headers.origin || "").trim();
  const trustedOrigins = new Set(allowedOrigins);
  try {
    trustedOrigins.add(new URL(configuredAppBaseUrl || getRequestOrigin(req)).origin);
  } catch {
    // A malformed request origin is never trusted.
  }

  if (origin) {
    if (!trustedOrigins.has(origin)) {
      return res.status(403).json({ error: "Cross-origin state-changing requests are not allowed" });
    }
  } else if (!hasValidApiKey(req)) {
    return res.status(403).json({ error: "State-changing API requests require a trusted Origin or API key" });
  }

  const pathname = new URL(req.originalUrl || req.url || "/", appBaseUrl).pathname;
  const jsonOnlyPaths = new Set([
    "/api/chat",
    "/api/chat/jobs",
    "/api/session/workspace",
    "/api/session/branch"
  ]);
  if (req.method === "POST" && jsonOnlyPaths.has(pathname) && !req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type application/json is required" });
  }

  return next();
});

app.use("/api", (req, res, next) => {
  const workspaceCode = resolveRequestedWorkspaceCode(req);
  if (!workspaceCode) {
    return res.status(403).json({ error: "workspace access code is not allowed" });
  }

  const context = workspaceContextForCode(workspaceCode);
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

app.get("/api/chat/archive", async (req, res) => {
  if (!authEnabled) {
    return res.status(503).json({ error: "Server chat archives require Basic Auth to be enabled." });
  }
  try {
    const profile = chatArchiveProfile(req);
    const stored = await readStoredArchive(chatArchiveRoot, chatArchiveSubjectForProfile(req, profile));
    if (!stored) return res.json({ ok: true, format: CHAT_ARCHIVE_FORMAT, profile, exists: false, payload: null });
    return res.json({ ok: true, format: CHAT_ARCHIVE_FORMAT, profile, exists: true, payload: stored.payload });
  } catch (error) {
    console.error("Failed to read chat archive:", error?.message || error);
    return res.status(500).json({ error: "Failed to read server chat archive." });
  }
});

app.put("/api/chat/archive", async (req, res) => {
  if (!authEnabled) {
    return res.status(503).json({ error: "Server chat archives require Basic Auth to be enabled." });
  }
  try {
    const profile = chatArchiveProfile(req);
    const payload = normalizeStoredArchivePayload(req.body?.payload);
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > chatArchiveMaxBytes) {
      return res.status(413).json({ error: `archive exceeds ${chatArchiveMaxBytes} byte limit` });
    }
    await writeStoredArchive(chatArchiveRoot, chatArchiveSubjectForProfile(req, profile), payload);
    return res.json({ ok: true, format: CHAT_ARCHIVE_FORMAT, profile, encrypted: payload.encrypted, bytes: Buffer.byteLength(serialized, "utf8") });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Invalid chat archive") });
  }
});

app.post("/api/design/workspace", async (req, res) => {
  try {
    const slug = designWorkspaceSlug(req.body?.name);
    const rootRel = path.join("design-workspaces", slug);
    const project = designWorkspaceText(req.body?.project, "project idea");
    const context = designWorkspaceText(req.body?.context, "project context");
    const artifact = designWorkspaceText(req.body?.artifact, "design artifact");
    const provider = designWorkspaceText(req.body?.provider, "provider", 120);
    const model = designWorkspaceText(req.body?.model, "model", 180);
    const stage = designWorkspaceText(req.body?.stage, "stage", 80);
    const files = new Map([
      ["README.md", `# ${slug}\n\nCreated from the Remote AI Access Design Lab.\n\n- Provider: ${provider || "(not selected)"}\n- Model: ${model || "(not selected)"}\n- Last stage: ${stage || "(unknown)"}\n\nSee the accompanying Markdown files for the full design inputs and output.\n`],
      ["feature-idea.md", `${project}\n`],
      ["project-context.md", `${context || "(No additional context supplied.)"}\n`],
      ["design-artifact.md", `${artifact || "(No design artifact supplied.)"}\n`],
      ["design-manifest.json", `${JSON.stringify({ format: "remote-ai-design-workspace-v1", createdAt: new Date().toISOString(), provider, model, stage, source: "design-lab" }, null, 2)}\n`]
    ]);
    for (const [name, content] of files) {
      const { absolute } = resolveSandboxPath(path.join(rootRel, name));
      await fsp.mkdir(path.dirname(absolute), { recursive: true });
      await fsp.writeFile(absolute, content, { encoding: "utf8", mode: 0o600 });
    }
    await commitSandboxSnapshot(`create design workspace ${slug}`, [...files.keys()].map((name) => path.join(rootRel, name)));
    await appendAuditLog(req, "design-workspace-create", { path: rootRel, fileCount: files.size });
    return res.status(201).json({ ok: true, workspace: slug, path: rootRel, files: [...files.keys()] });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to create design workspace") });
  }
});

app.post("/api/files/browser-session", (req, res) => {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + browserFileSessionTtlMs;
  browserFileSessions.set(token, expiresAt);

  for (const [storedToken, storedExpiresAt] of browserFileSessions) {
    if (storedExpiresAt <= Date.now()) {
      browserFileSessions.delete(storedToken);
    }
  }

  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${browserFileSessionCookieName}=${encodeURIComponent(token)}; Path=/api/files; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(browserFileSessionTtlMs / 1000)}${secure}`
  );
  return res.json({ ok: true, expiresAt: new Date(expiresAt).toISOString() });
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
      workspaceAgentStepOverrideCodesRaw: String(settings.workspaceAgentStepOverrideCodesRaw || ""),
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
      workspaceAgentStepOverrideCodesRaw: payload.workspaceAgentStepOverrideCodesRaw,
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
        workspaceAgentStepOverrideCodesRaw: String(saved.workspaceAgentStepOverrideCodesRaw || ""),
        workspaceUploadBypassCodesRaw: String(saved.workspaceUploadBypassCodesRaw || ""),
        updatedAt: saved.updatedAt || null,
        settingsDbPath: adminSettingsDbPath
      }
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to save admin security settings") });
  }
});

app.get("/api/admin/deployment-approvals", async (req, res) => {
  try {
    const workspaceCode = getWorkspaceContext().code;
    const db = await readDeploymentApprovalDb();
    const approvals = db.approvals
      .filter((approval) => approval.workspaceCode === workspaceCode)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, 100)
      .map(publicDeploymentApproval);
    return res.json({ ok: true, workspaceCode, approvals });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || "Failed to read deployment approvals") });
  }
});

app.post("/api/admin/deployment-approvals", async (req, res) => {
  try {
    const preview = await previewWorkspaceDeployment({ action: "preview", manifest: req.body?.manifest });
    const created = createDeploymentApproval({
      workspaceCode: getWorkspaceContext().code,
      manifest: preview.manifest,
      action: req.body?.action || "activate",
      ttlMs: req.body?.ttlMs
    });
    await mutateDeploymentApprovalDb((db) => {
      db.approvals = [created.record, ...db.approvals].slice(0, 1000);
    });
    await appendAuditLog(req, "deployment-approval-create", {
      id: created.record.id,
      application: created.record.application,
      hostname: created.record.hostname,
      manifestDigest: created.record.manifestDigest,
      expiresAt: created.record.expiresAt
    });
    return res.status(201).json({
      ok: true,
      approval: publicDeploymentApproval(created.record),
      token: created.token,
      warning: "This one-time token is shown only in this response."
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to create deployment approval") });
  }
});

app.delete("/api/admin/deployment-approvals/:approvalId", async (req, res) => {
  try {
    const revoked = await mutateDeploymentApprovalDb((db) => {
      const approval = findDeploymentApproval(db, req.params.approvalId);
      if (!approval) throw Object.assign(new Error("deployment approval not found"), { status: 404 });
      if (approval.workspaceCode !== getWorkspaceContext().code) {
        throw Object.assign(new Error("deployment approval belongs to a different workspace"), { status: 403 });
      }
      const result = revokeDeploymentApproval(approval);
      db.approvals = db.approvals.map((item) => item.id === result.id ? result : item);
      return result;
    });
    await appendAuditLog(req, "deployment-approval-revoke", { id: revoked.id, application: revoked.application, hostname: revoked.hostname });
    return res.json({ ok: true, approval: publicDeploymentApproval(revoked) });
  } catch (error) {
    return res.status(error?.status || 400).json({ error: String(error?.message || "Failed to revoke deployment approval") });
  }
});

app.use(
  "/api/chat",
  cors({
    origin(origin, callback) {
      const trustedOrigins = new Set(allowedOrigins);
      try {
        trustedOrigins.add(new URL(configuredAppBaseUrl || appBaseUrl).origin);
      } catch {
        // Invalid configured origins are not trusted.
      }
      if (!origin || trustedOrigins.has(origin)) {
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
  const remoteHttpsUrl = getWorkspaceBareRepoHttpsUrl(req, context.code);
  res.json({
    workspaceCode: context.code,
    cookieName: workspaceCookieName,
    constrainedByAllowList: allowedWorkspaceCodes.length > 0,
    autoSessionBranching: enableAutoSessionBranching,
    currentBranch: currentBranch || workspaceBranchState.get(context.code) || null,
    gitRemote: {
      remoteName: workspaceGitRemoteName,
      remoteHttpsUrl
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

function getApiKeyFromBasicAuth(req) {
  const header = String(req.headers.authorization || "");
  if (!header.toLowerCase().startsWith("basic ")) {
    return "";
  }
  try {
    const decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    return sep >= 0 ? decoded.slice(sep + 1).trim() : "";
  } catch {
    return "";
  }
}

function requireGitHttpAuth(req, res) {
  const security = getEffectiveSecuritySettingsSync();
  if (!security.apiKeyAuthEnabled || security.apiKeys.length === 0) {
    return true;
  }

  const headerValue = String(req.headers[security.apiKeyHeaderName] || "").trim();
  const basicPassword = getApiKeyFromBasicAuth(req);
  const providedKey = headerValue || basicPassword;
  if (providedKey && security.apiKeys.includes(providedKey)) {
    return true;
  }

  res.set("WWW-Authenticate", "Basic realm=Remote AI Access Git");
  res.status(401).send("API key required for Git HTTPS. Use the API key as the Basic auth password or provide the API key header.");
  return false;
}

function parseGitHttpCgiHeaders(headerText) {
  const headers = {};
  let statusCode = 200;
  const lines = String(headerText || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const sep = line.indexOf(":");
    if (sep < 0) {
      continue;
    }
    const name = line.slice(0, sep).trim();
    const value = line.slice(sep + 1).trim();
    if (!name) {
      continue;
    }
    if (name.toLowerCase() === "status") {
      const match = value.match(/^(\d{3})/);
      if (match) {
        statusCode = Number(match[1]);
      }
    } else {
      headers[name] = value;
    }
  }
  return { statusCode, headers };
}

function writeGitHttpBackendOutput(res, output) {
  const separator = output.indexOf("\r\n\r\n");
  const fallbackSeparator = output.indexOf("\n\n");
  const headerEnd = separator >= 0 ? separator : fallbackSeparator;
  const delimiterLength = separator >= 0 ? 4 : 2;
  if (headerEnd < 0) {
    res.status(502).send("Invalid git backend response.");
    return;
  }

  const headerText = output.subarray(0, headerEnd).toString("utf8");
  const body = output.subarray(headerEnd + delimiterLength);
  const { statusCode, headers } = parseGitHttpCgiHeaders(headerText);
  Object.entries(headers).forEach(([name, value]) => {
    res.setHeader(name, value);
  });
  res.status(statusCode).send(body);
}

async function handleGitHttp(req, res, next) {
  try {
    const workspaceCode = normalizeWorkspaceCode(req.params.workspace);
    if (!workspaceCode || (allowedWorkspaceCodes.length > 0 && !allowedWorkspaceCodes.includes(workspaceCode))) {
      return res.status(404).send("Repository not found.");
    }
    if (!requireGitHttpAuth(req, res)) {
      return;
    }

    const context = workspaceContextForCode(workspaceCode);
    await workspaceContextStore.run(context, async () => {
      await ensureSandboxReady();
      await ensureWorkspaceGitRemoteSetup(req);
    });

    const pathInfo = `/${workspaceCode}.git${req.params[0] ? `/${req.params[0]}` : ""}`;
    const child = spawn("git", ["http-backend"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: workspaceGitRemoteRoot,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: pathInfo,
        REQUEST_METHOD: req.method,
        QUERY_STRING: new URL(req.originalUrl || req.url || "/", appBaseUrl).searchParams.toString(),
        CONTENT_TYPE: String(req.headers["content-type"] || ""),
        CONTENT_LENGTH: String(req.headers["content-length"] || ""),
        REMOTE_USER: workspaceCode
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", next);
    child.stdin.on("error", () => {
      // The git backend can close stdin early after rejecting a request.
    });
    child.on("close", (code) => {
      if (code && code !== 0) {
        const message = Buffer.concat(stderr).toString("utf8").trim() || "git http-backend failed";
        res.status(500).send(message);
        return;
      }
      writeGitHttpBackendOutput(res, Buffer.concat(stdout));
    });
    req.pipe(child.stdin);
  } catch (error) {
    next(error);
  }
}

app.all(/^\/git\/([a-z0-9][a-z0-9_-]{1,47})\.git(?:\/(.*))?$/, (req, res, next) => {
  req.params = { workspace: req.params[0], 0: req.params[1] || "" };
  handleGitHttp(req, res, next);
});

async function generateChatResponseCore(req) {
  const traceId = resolveRequestTraceId(req) || createTraceId();
  req.traceId = traceId;
  assertNotAborted(req);
  const provider = String(req.body?.provider || defaultProvider).trim().toLowerCase();
  const agentMode = Boolean(req.body?.agentMode);
  if (agentMode) {
    assertAgentToolAuthorized(req);
  }
  if (provider !== "openai" && provider !== "copilot" && !externalProviderConfigs[provider]) {
    const error = new Error(`provider '${provider}' is not configured on this server yet`);
    error.status = 400;
    throw error;
  }

  const messageContext = resolveMessageContext(req.body);
  if (!messageContext?.messages) {
    const error = new Error("messages must contain non-empty user or assistant items within size limits");
    error.status = 400;
    throw error;
  }
  const messages = messageContext.messages;
  const compaction = messageContext.compaction || { applied: false };

  if (provider === "openai") {
    if (!client) {
      const error = new Error("openai provider is not enabled: missing OPENAI_API_KEY");
      error.status = 400;
      throw error;
    }

    const model = resolveModel(req.body?.model);
    const reasoningEffort = normalizeReasoningEffort(req.body?.reasoningEffort || req.body?.reasoning_effort);
    if ((req.body?.reasoningEffort || req.body?.reasoning_effort) && !reasoningEffort) {
      const error = new Error("reasoningEffort must be one of: none, minimal, low, medium, high, xhigh, max");
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
        contextCompaction: compaction,
        agentMode: true,
        agentMaxStepsUsed: stepBudget.maxSteps,
        agentMaxStepsOverrideUsed: stepBudget.override,
        executedTools: result.executedTools,
        usage: result.usage
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
    return { reply: text, model, provider: "openai", traceId, reasoningEffort: reasoningEffort || null, contextCompaction: compaction, usage: response.usage };
  }

  if (provider === "copilot") {
    if (!githubPat) {
      const error = new Error("copilot provider is not enabled: missing GITHUB_PAT or GITHUB_TOKEN");
      error.status = 400;
      throw error;
    }

    const model = resolveCopilotModel(req.body?.model);

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
        model,
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
      model,
      provider: "copilot",
      traceId,
      contextCompaction: compaction,
      usage: copilotData?.usage
    };
  }

  if (provider === "anthropic") {
    if (!anthropicApiKey) {
      const error = new Error("anthropic provider is not enabled: missing ANTHROPIC_API_KEY");
      error.status = 400;
      throw error;
    }

    if (agentMode) {
      const error = new Error("anthropic provider does not support Agent Tools mode yet");
      error.status = 400;
      throw error;
    }

    const model = resolveExternalProviderModel(provider, req.body?.model);
    const anthropicData = await createAnthropicMessage(model, messages, { abortSignal: req?.abortSignal });
    const text = Array.isArray(anthropicData?.content)
      ? anthropicData.content
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("")
      : "";

    return {
      reply: text || JSON.stringify(anthropicData?.content || ""),
      model,
      provider: "anthropic",
      traceId,
      contextCompaction: compaction,
      usage: anthropicData?.usage
    };
  }

  if (compatibleProviderConfigs[provider]) {
    const providerConfig = compatibleProviderConfigs[provider];
    if (!providerConfig.apiKey) {
      const error = new Error(`${provider} provider is not enabled: missing ${provider.toUpperCase()}_API_KEY`);
      error.status = 400;
      throw error;
    }

    let model = resolveExternalProviderModel(provider, req.body?.model);
    const reasoningEffort = providerConfig.supportsReasoningEffort
      ? normalizeReasoningEffort(req.body?.reasoningEffort || req.body?.reasoning_effort)
      : null;
    if (providerConfig.supportsReasoningEffort && (req.body?.reasoningEffort || req.body?.reasoning_effort) && !reasoningEffort) {
      const error = new Error("reasoningEffort must be one of: none, minimal, low, medium, high, xhigh, max");
      error.status = 400;
      throw error;
    }
    const stepBudget = agentMode ? resolveAgentStepBudget(req) : { maxSteps: agentMaxSteps, override: false };
    if (agentMode) {
      if (!supportsCompatibleAgentModel(provider, model)) {
        const error = new Error(`${provider} model '${model}' is not enabled for Agent Tools mode`);
        error.status = 400;
        throw error;
      }
      const result = await runCompatibleAgentWithTools(req, provider, model, messages, stepBudget.maxSteps, reasoningEffort);
      return {
        reply: result.text,
        model,
        provider,
        traceId,
        contextCompaction: compaction,
        agentMode: true,
        agentMaxStepsUsed: stepBudget.maxSteps,
        agentMaxStepsOverrideUsed: stepBudget.override,
        reasoningEffort: reasoningEffort || null,
        executedTools: result.executedTools,
        usage: result.usage
      };
    }

    const body = { model, messages };
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }
    let data;
    try {
      data = await createOpenAiCompatibleChatCompletion(provider, model, messages, {
        ...body,
        abortSignal: req?.abortSignal
      });
    } catch (error) {
      // Some Google models remain listed but are unavailable for specific accounts.
      if (provider === "google" && Number(error?.status || 0) === 404 && model !== providerConfig.defaultModel) {
        model = providerConfig.defaultModel;
        data = await createOpenAiCompatibleChatCompletion(provider, model, messages, {
          model,
          messages,
          abortSignal: req?.abortSignal
        });
      } else {
        throw error;
      }
    }
    const text = Array.isArray(data?.choices)
      ? (data.choices[0]?.message?.content || "")
      : "";

    return {
      reply: typeof text === "string" ? text : JSON.stringify(text),
      model,
      provider,
      traceId,
      reasoningEffort: reasoningEffort || null,
      contextCompaction: compaction,
      usage: data?.usage
    };
  }

  const error = new Error(`provider '${provider}' is not configured on this server yet`);
  error.status = 400;
  throw error;
}

async function generateChatResponse(req) {
  await enforceUsageHardLimits();
  const startedAt = Date.now();
  try {
    const result = await generateChatResponseCore(req);
    await recordProviderUsage(req, result, Date.now() - startedAt, true);
    return result;
  } catch (error) {
    await recordProviderUsage(req, { provider: req.body?.provider, model: req.body?.model }, Date.now() - startedAt, false, error?.message);
    throw error;
  }
}

app.post("/api/chat", async (req, res) => {
  try {
    const result = await generateChatResponse(req);
    result.contextMutations = Array.isArray(req.agentContextMutations) ? req.agentContextMutations : [];
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
  const job = enqueueChatJob(req);
  await saveChatJobState();

  return res.status(202).json({
    ok: true,
    job: getChatJobResponse(job)
  });
});

app.get("/api/chat/recipe-schedules", async (req, res) => {
  const workspaceCode = getWorkspaceContext().code;
  const schedules = [...agentRecipeScheduleStore.values()]
    .filter((schedule) => schedule.workspaceCode === workspaceCode)
    .sort((left, right) => Number(new Date(left.nextRunAt || 0)) - Number(new Date(right.nextRunAt || 0)))
    .map(publicAgentRecipeSchedule);
  return res.json({ ok: true, schedules });
});

app.post("/api/chat/recipe-schedules", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const prompt = String(req.body?.prompt || "").trim().slice(0, chatMessageMaxChars);
    if (!name || !prompt) return res.status(400).json({ error: "name and prompt are required" });
    const providerModel = resolveScheduledProviderModel(req.body?.provider, req.body?.model);
    const timing = normalizeAgentRecipeSchedule(req.body, Date.now());
    const id = `recipe-schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const schedule = {
      id,
      workspaceCode: getWorkspaceContext().code,
      name,
      prompt,
      provider: providerModel.provider,
      model: providerModel.model,
      priority: normalizeChatJobPriority(req.body?.priority),
      toolProfile: normalizeAgentToolProfile(req.body?.toolProfile),
      autoCheckpoint: Boolean(req.body?.autoCheckpoint),
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      lastCompletedAt: null,
      lastJobId: null,
      lastJobStatus: null,
      ...timing,
      timer: null
    };
    agentRecipeScheduleStore.set(id, schedule);
    await saveAgentRecipeSchedules();
    armAgentRecipeSchedule(schedule);
    await appendAuditLog(req, "agent-recipe-schedule-create", { id, name, provider: schedule.provider, model: schedule.model, kind: schedule.kind });
    return res.status(201).json({ ok: true, schedule: publicAgentRecipeSchedule(schedule) });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to create schedule") });
  }
});

app.patch("/api/chat/recipe-schedules/:scheduleId", async (req, res) => {
  const schedule = agentRecipeScheduleStore.get(String(req.params.scheduleId || ""));
  if (!schedule) return res.status(404).json({ error: "schedule not found" });
  if (schedule.workspaceCode !== getWorkspaceContext().code) return res.status(403).json({ error: "schedule belongs to a different workspace" });
  schedule.enabled = req.body?.enabled !== false;
  if (schedule.enabled && !schedule.nextRunAt) schedule.nextRunAt = calculateNextRunAt(schedule, Date.now());
  await saveAgentRecipeSchedules();
  armAgentRecipeSchedule(schedule);
  return res.json({ ok: true, schedule: publicAgentRecipeSchedule(schedule) });
});

app.delete("/api/chat/recipe-schedules/:scheduleId", async (req, res) => {
  const schedule = agentRecipeScheduleStore.get(String(req.params.scheduleId || ""));
  if (!schedule) return res.status(404).json({ error: "schedule not found" });
  if (schedule.workspaceCode !== getWorkspaceContext().code) return res.status(403).json({ error: "schedule belongs to a different workspace" });
  if (schedule.timer) clearTimeout(schedule.timer);
  agentRecipeScheduleStore.delete(schedule.id);
  await saveAgentRecipeSchedules();
  await appendAuditLog(req, "agent-recipe-schedule-delete", { id: schedule.id, name: schedule.name });
  return res.json({ ok: true });
});

app.get("/api/chat/jobs", async (req, res) => {
  pruneChatJobs();
  const workspaceCode = getWorkspaceContext().code;
  const jobs = [...chatJobStore.values()]
    .filter((job) => job.workspaceCode === workspaceCode)
    .sort((left, right) => Number(new Date(right.createdAt)) - Number(new Date(left.createdAt)))
    .slice(0, 100)
    .map(getChatJobResponse);
  return res.json({
    ok: true,
    queue: {
      paused: pausedChatJobWorkspaces.has(workspaceCode),
      maxConcurrent: chatJobMaxConcurrent,
      active: activeWorkspaceChatJobCount(workspaceCode),
      workspaceMaxConcurrent: workspaceChatJobLimit(workspaceCode),
      globalActive: activeChatJobCount(),
      queued: jobs.filter((job) => job.status === "queued").length
    },
    jobs
  });
});

app.get("/api/activity", async (req, res) => {
  try {
    const workspaceCode = getWorkspaceContext().code;
    const audit = await readAuditEntries({ limit: 1000 });
    const chatJobs = [...chatJobStore.values()].filter((job) => job.workspaceCode === workspaceCode);
    const subagentJobs = [...subagentJobStore.values()].filter((job) => job.workspaceCode === workspaceCode);
    const events = buildWorkspaceActivityTimeline({
      auditEntries: audit.entries,
      chatJobs,
      subagentJobs
    }, {
      category: req.query.category,
      traceId: req.query.traceId || req.query.trace,
      query: req.query.query,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit
    });
    const categories = events.reduce((counts, event) => {
      counts[event.category] = (counts[event.category] || 0) + 1;
      return counts;
    }, {});
    return res.json({ ok: true, workspaceCode, count: events.length, categories, events });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to build workspace activity") });
  }
});

app.get("/api/chat/subagents", async (req, res) => {
  const workspaceCode = getWorkspaceContext().code;
  const requestedStatus = String(req.query?.status || "").trim().toLowerCase();
  const requestedParentId = String(req.query?.parentId || "").trim();
  const allowedStatuses = new Set(["awaiting_approval", "queued", "running", "completed", "failed", "cancelled"]);
  if (requestedStatus && !allowedStatuses.has(requestedStatus)) {
    return res.status(400).json({ error: "invalid subagent status filter" });
  }
  const jobs = [...subagentJobStore.values()]
    .filter((job) => job.workspaceCode === workspaceCode)
    .filter((job) => !requestedStatus || job.status === requestedStatus)
    .filter((job) => !requestedParentId || job.parentId === requestedParentId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 100)
    .map(publicSubagentJob);
  const summary = {
    total: jobs.length,
    active: jobs.filter((job) => ["awaiting_approval", "queued", "running"].includes(job.status)).length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => ["failed", "cancelled"].includes(job.status)).length
  };
  return res.json({ ok: true, workspaceCode, summary, jobs });
});

app.delete("/api/chat/subagents/:subagentId", async (req, res) => {
  const job = subagentJobStore.get(String(req.params.subagentId || "").trim());
  if (!job) return res.status(404).json({ error: "subagent not found" });
  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "subagent belongs to a different workspace" });
  }
  if (!["awaiting_approval", "queued", "running"].includes(job.status)) {
    return res.status(409).json({ error: "only active subagents can be cancelled", job: publicSubagentJob(job) });
  }
  cancelSubagentJob(job, "Cancelled from operations UI");
  await appendAuditLog(req, "subagent-cancel", { id: job.id, parentId: job.parentId, source: "operations-ui" });
  return res.json({ ok: true, job: publicSubagentJob(job) });
});

app.post("/api/chat/subagents/:subagentId/approve", async (req, res) => {
  const requestOrigin = String(req.headers.origin || "").trim();
  if (!requestOrigin || (authEnabled && !req.basicAuthAuthenticated)) {
    return res.status(403).json({ error: "coding subagent approval requires an authenticated browser session" });
  }
  const job = subagentJobStore.get(String(req.params.subagentId || "").trim());
  if (!job) return res.status(404).json({ error: "subagent not found" });
  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "subagent belongs to a different workspace" });
  }
  if (job.role !== "coding" || job.status !== "awaiting_approval") {
    return res.status(409).json({ error: "only pending coding subagents can be approved", job: publicSubagentJob(job) });
  }
  const activeSiblings = [...subagentJobStore.values()].filter((candidate) => (
    candidate.parentId === job.parentId && ["queued", "running"].includes(candidate.status)
  ));
  if (activeSiblings.length >= SUBAGENT_LIMITS.maxConcurrentPerParent) {
    return res.status(429).json({ error: "concurrent subagent limit reached for this parent" });
  }
  job.approvedAt = new Date().toISOString();
  recordSubagentEvent(job, "approved", { allowedTools: job.allowedTools, allowedPaths: job.allowedPaths });
  startSubagentJob(job);
  await appendAuditLog(req, "subagent-coding-approval", {
    id: job.id,
    parentId: job.parentId,
    allowedTools: job.allowedTools,
    allowedPaths: job.allowedPaths
  });
  return res.json({ ok: true, job: publicSubagentJob(job) });
});

app.post("/api/chat/subagents/:subagentId/tdd-approve", async (req, res) => {
  try {
    const requestOrigin = String(req.headers.origin || "").trim();
    if (!requestOrigin || (authEnabled && !req.basicAuthAuthenticated)) {
      return res.status(403).json({ error: "TDD approval requires an authenticated browser session" });
    }
    const job = subagentJobStore.get(String(req.params.subagentId || "").trim());
    if (!job) return res.status(404).json({ error: "subagent not found" });
    if (job.workspaceCode !== getWorkspaceContext().code) {
      return res.status(403).json({ error: "subagent belongs to a different workspace" });
    }
    if (job.role !== "coding" || !job.tdd) {
      return res.status(409).json({ error: "this coding child does not have a TDD workflow", job: publicSubagentJob(job) });
    }
    job.tdd = approveTddCommit(job.tdd);
    recordSubagentEvent(job, "tdd-commit-approved", { attempt: job.tdd.attempt });
    await appendAuditLog(req, "subagent-tdd-approval", { id: job.id, parentId: job.parentId, attempt: job.tdd.attempt });
    return res.json({ ok: true, job: publicSubagentJob(job) });
  } catch (error) {
    return res.status(Number(error?.status || 400)).json({ error: String(error?.message || "TDD approval failed") });
  }
});

app.patch("/api/chat/subagents/:subagentId/acceptance", async (req, res) => {
  try {
    const job = subagentJobStore.get(String(req.params.subagentId || "").trim());
    if (!job) return res.status(404).json({ error: "subagent not found" });
    if (job.workspaceCode !== getWorkspaceContext().code) {
      return res.status(403).json({ error: "subagent belongs to a different workspace" });
    }
    if (job.status !== "completed" || !job.result) {
      return res.status(409).json({ error: "only completed subagent output can be reviewed" });
    }
    job.acceptance = mergeSubagentAcceptance(job, req.body);
    await appendAuditLog(req, "subagent-acceptance", {
      id: job.id,
      parentId: job.parentId,
      artifacts: job.acceptance.artifacts,
      context: job.acceptance.context
    });
    return res.json({ ok: true, acceptance: job.acceptance });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to update subagent acceptance") });
  }
});

app.post("/api/chat/jobs/queue-control", async (req, res) => {
  const workspaceCode = getWorkspaceContext().code;
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (action === "pause") {
    pausedChatJobWorkspaces.add(workspaceCode);
  } else if (action === "resume") {
    pausedChatJobWorkspaces.delete(workspaceCode);
    queueMicrotask(dispatchChatJobs);
  } else {
    return res.status(400).json({ error: "action must be pause or resume" });
  }
  await saveChatJobState();
  return res.json({ ok: true, paused: pausedChatJobWorkspaces.has(workspaceCode) });
});

app.patch("/api/chat/jobs/:jobId", async (req, res) => {
  pruneChatJobs();
  const job = chatJobStore.get(String(req.params.jobId || "").trim());
  if (!job) {
    return res.status(404).json({ error: "chat job not found" });
  }
  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "chat job belongs to a different workspace" });
  }
  if (job.status !== "queued") {
    return res.status(409).json({ error: "only queued jobs can change priority" });
  }
  job.priority = normalizeChatJobPriority(req.body?.priority);
  job.updatedAt = new Date().toISOString();
  recordChatJobEvent(job, "priority-changed", { priority: job.priority });
  await saveChatJobState();
  queueMicrotask(dispatchChatJobs);
  return res.json({ ok: true, job: getChatJobResponse(job) });
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

app.post("/api/chat/jobs/:jobId/input", async (req, res) => {
  pruneChatJobs();
  const jobId = String(req.params.jobId || "").trim();
  const job = chatJobStore.get(jobId);
  if (!job) return res.status(404).json({ error: "chat job not found" });
  if (job.workspaceCode !== getWorkspaceContext().code) {
    return res.status(403).json({ error: "chat job belongs to a different workspace" });
  }
  if (job.status !== "needs_input" || !job.question) {
    return res.status(409).json({ error: "chat job is not waiting for input", job: getChatJobResponse(job) });
  }
  const questionId = String(req.body?.questionId || "").trim();
  if (questionId && questionId !== job.question.id) {
    return res.status(409).json({ error: "question is stale", job: getChatJobResponse(job) });
  }
  const answer = String(req.body?.answer || "").trim().slice(0, 4000);
  if (!answer) return res.status(400).json({ error: "answer is required" });
  if (job.question.choices.length > 0 && !job.question.choices.includes(answer)) {
    return res.status(400).json({ error: "answer must match one of the offered choices", choices: job.question.choices });
  }

  job.question = { ...job.question, answer, answeredAt: new Date().toISOString() };
  job.requestBody = {
    ...(job.requestBody || {}),
    messages: [
      ...(Array.isArray(job.requestBody?.messages) ? job.requestBody.messages : []),
      { role: "user", content: `Answer to agent question (${job.question.prompt}): ${answer}` }
    ]
  };
  recordChatJobEvent(job, "user-input-received", { questionId: job.question.id });
  job.question = null;
  job.execution = createChatJobExecution(job, job.requestBody, req);
  setChatJobStatus(job, "queued", { eventPayload: { resumedFromQuestion: questionId || null } });
  await appendAuditLog(req, "chat-job-user-input", { jobId, questionId: questionId || null });
  await saveChatJobState();
  queueMicrotask(dispatchChatJobs);
  return res.status(202).json({ ok: true, job: getChatJobResponse(job) });
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
  await saveChatJobState();
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
  const supportedProviders = configuredProviders();
  const defaultModelsByProvider = {
    openai: defaultModel,
    copilot: copilotDefaultModel,
    ...Object.fromEntries(Object.entries(externalProviderConfigs).map(([provider, config]) => [provider, config.defaultModel]))
  };
  const allowedModelsByProvider = {
    openai: allowedModels,
    copilot: copilotAllowedModels,
    ...Object.fromEntries(Object.entries(externalProviderConfigs).map(([provider, config]) => [provider, config.allowedModels]))
  };
  const agentModeModelsByProvider = Object.fromEntries(
    Object.entries(compatibleProviderConfigs)
      .filter(([, config]) => Array.isArray(config.agentModels))
      .map(([provider, config]) => [provider, compatibleAgentModelsForConfig(config)])
  );

  res.json({
    defaultProvider,
    defaultModel: defaultModelsByProvider[defaultProvider] || defaultModel,
    allowedModels,
    defaultModelsByProvider,
    allowedModelsByProvider,
    agentModeModelsByProvider,
    googleDefaultModel,
    googleAllowedModels,
    xaiDefaultModel,
    xaiAllowedModels,
    supportedProviders,
    agentModeSupportedProviders: [
      ...(openaiApiKey ? ["openai"] : []),
      ...Object.entries(compatibleProviderConfigs)
        .filter(([, config]) => {
          const agentModels = compatibleAgentModelsForConfig(config);
          return config.apiKey && config.supportsAgentMode && (agentModels === null || agentModels.length > 0);
        })
        .map(([provider]) => provider)
    ],
    agentStepOverride: {
      enabled: Boolean(security.agentMaxStepsOverrideCode || security.workspaceAgentStepOverrideCodes.size),
      baseMaxSteps: agentMaxSteps,
      maxOverrideSteps: agentMaxStepsOverrideLimit
    },
    chatCompaction: {
      enabled: true,
      messageMaxChars: chatMessageMaxChars,
      contextMaxChars: chatContextMaxChars,
      summaryMaxChars: chatCompactionSummaryMaxChars
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

app.get("/api/operations/health", async (_req, res) => {
  const context = getWorkspaceContext();
  const providerConfigured = {
    openai: Boolean(openaiApiKey),
    google: Boolean(googleApiKey),
    xai: Boolean(xaiApiKey),
    copilot: Boolean(githubPat),
    deepseek: Boolean(deepseekApiKey),
    anthropic: Boolean(anthropicApiKey),
    together: Boolean(togetherApiKey),
    openrouter: Boolean(openRouterApiKey)
  };
  const checks = {
    providers: {
      status: Object.values(providerConfigured).some(Boolean) ? "ok" : "error",
      configured: providerConfigured
    },
    docker: {
      status: terminalRuntime === "docker" ? "checking" : "disabled",
      runtime: terminalRuntime,
      image: terminalRuntime === "docker" ? terminalDockerImage : null
    },
    git: { status: "checking", branch: null, clean: null },
    storage: { status: "checking", writable: null, totalBytes: null, availableBytes: null, usedPercent: null }
  };

  const tasks = [];
  if (terminalRuntime === "docker") {
    tasks.push(execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 })
      .then(({ stdout }) => {
        checks.docker.status = "ok";
        checks.docker.version = String(stdout || "").trim() || null;
      })
      .catch((error) => {
        checks.docker.status = "error";
        checks.docker.message = String(error?.message || "Docker is unavailable").slice(0, 240);
      }));
  }

  tasks.push(runGit(["status", "--short", "--branch"], true)
    .then(({ stdout, code }) => {
      const lines = String(stdout || "").split("\n").filter(Boolean);
      checks.git.status = code ? "error" : "ok";
      checks.git.branch = String(lines[0] || "").replace(/^##\s*/, "") || null;
      checks.git.clean = lines.slice(1).length === 0;
    })
    .catch((error) => {
      checks.git.status = "error";
      checks.git.message = String(error?.message || "Git status unavailable").slice(0, 240);
    }));

  tasks.push(Promise.all([
    fsp.access(context.sandboxRoot, fs.constants.R_OK | fs.constants.W_OK),
    typeof fsp.statfs === "function" ? fsp.statfs(context.sandboxRoot) : Promise.resolve(null)
  ])
    .then(([, statfs]) => {
      checks.storage.status = "ok";
      checks.storage.writable = true;
      if (statfs) {
        const totalBytes = Number(statfs.blocks) * Number(statfs.bsize);
        const availableBytes = Number(statfs.bavail) * Number(statfs.bsize);
        checks.storage.totalBytes = totalBytes;
        checks.storage.availableBytes = availableBytes;
        checks.storage.usedPercent = totalBytes > 0 ? Number((((totalBytes - availableBytes) / totalBytes) * 100).toFixed(1)) : null;
      }
    })
    .catch((error) => {
      checks.storage.status = "error";
      checks.storage.message = String(error?.message || "Storage status unavailable").slice(0, 240);
    }));

  await Promise.all(tasks);
  const cpuTotals = os.cpus().reduce((totals, cpu) => {
    totals.idle += Number(cpu.times.idle || 0);
    totals.total += Object.values(cpu.times).reduce((sum, value) => sum + Number(value || 0), 0);
    return totals;
  }, { idle: 0, total: 0 });
  const memory = process.memoryUsage();
  const hostTotalMemory = os.totalmem();
  const workspaceJobs = [...chatJobStore.values()].filter((job) => job.workspaceCode === context.code);
  const latency = {};
  for (const [provider, values] of providerLatencyHistory.entries()) {
    const recent = values.slice(-20);
    latency[provider] = {
      samples: recent.length,
      averageMs: recent.length ? Math.round(recent.reduce((sum, value) => sum + value, 0) / recent.length) : null,
      latestMs: recent.at(-1) ?? null
    };
  }
  const sample = {
    timestamp: new Date().toISOString(),
    cpuPercent: calculateCpuPercent(previousHostCpuSnapshot, cpuTotals),
    memoryPercent: hostTotalMemory > 0 ? Number((((hostTotalMemory - os.freemem()) / hostTotalMemory) * 100).toFixed(1)) : null,
    process: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, uptimeSeconds: Math.round(process.uptime()) },
    diskPercent: checks.storage.usedPercent,
    queue: {
      queued: workspaceJobs.filter((job) => job.status === "queued").length,
      running: workspaceJobs.filter((job) => ["starting", "checkpointing", "running"].includes(job.status)).length,
      paused: pausedChatJobWorkspaces.has(context.code),
      subagents: [...subagentJobStore.values()].filter((job) => job.workspaceCode === context.code && ["queued", "running"].includes(job.status)).length
    },
    uploads: [...uploadSessionStore.values()].filter((session) => session.workspaceCode === context.code).length,
    providerLatency: latency
  };
  previousHostCpuSnapshot = cpuTotals;
  const summary = summarizeRuntimeSample(sample);
  const history = appendMetricSample(runtimeMetricHistory.get(context.code), sample, runtimeMetricHistoryLimit);
  runtimeMetricHistory.set(context.code, history);
  const statuses = Object.values(checks).map((check) => check.status);
  const degraded = statuses.includes("error") || summary.status === "degraded";
  return res.json({
    ok: !degraded,
    status: degraded ? "degraded" : "ok",
    workspaceCode: context.code,
    checkedAt: new Date().toISOString(),
    checks,
    metrics: sample,
    history,
    alerts: summary.alerts,
    thresholds: summary.thresholds
  });
});

async function listManagedToolContainers() {
  if (terminalRuntime !== "docker") return [];
  const { stdout } = await execFileAsync("docker", [
    "ps", "-a", "--size",
    "--filter", `label=${MANAGED_TOOL_CONTAINER_LABEL}`,
    "--format", "{{json .}}"
  ], { timeout: 15_000 });
  return parseManagedToolContainers(stdout);
}

app.get("/api/operations/tool-containers", async (_req, res) => {
  try {
    const containers = await listManagedToolContainers();
    return res.json({ ok: true, enabled: terminalRuntime === "docker", count: containers.length, containers });
  } catch (error) {
    return res.status(503).json({ error: String(error?.message || "Failed to list managed tool containers") });
  }
});

app.delete("/api/operations/tool-containers", async (req, res) => {
  const requestOrigin = String(req.headers.origin || "").trim();
  if (!requestOrigin || (authEnabled && !req.basicAuthAuthenticated)) {
    return res.status(403).json({ error: "managed container cleanup requires an authenticated browser session" });
  }
  if (String(req.body?.confirmation || "") !== MANAGED_TOOL_CONTAINER_CONFIRMATION) {
    return res.status(400).json({ error: "managed container cleanup confirmation is required" });
  }
  try {
    const containers = await listManagedToolContainers();
    const ids = managedToolContainerIds(containers);
    if (ids.length > 0) {
      await execFileAsync("docker", ["rm", "-f", ...ids], { timeout: 60_000 });
    }
    await appendAuditLog(req, "managed-tool-containers-remove", {
      count: ids.length,
      containers: containers.map((item) => ({ id: item.id, name: item.name, image: item.image }))
    });
    return res.json({ ok: true, removed: ids.length });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || "Failed to remove managed tool containers") });
  }
});

app.get("/api/usage", async (req, res) => {
  try {
    const context = getWorkspaceContext();
    const period = String(req.query.period || "month").toLowerCase() === "day" ? "day" : "month";
    const traceId = String(req.query.traceId || "").trim().slice(0, 120);
    const fromDate = new Date();
    if (period === "day") fromDate.setUTCHours(0, 0, 0, 0);
    else { fromDate.setUTCDate(1); fromDate.setUTCHours(0, 0, 0, 0); }
    const aggregate = aggregateUsage(await readUsageLedger(), { workspaceCode: context.code, traceId, from: fromDate.getTime() });
    const groups = {};
    const days = {};
    for (const entry of aggregate.entries) {
      const key = `${entry.provider}/${entry.model}`;
      groups[key] ||= [];
      groups[key].push(entry);
      const day = String(entry.timestamp).slice(0, 10);
      days[day] ||= [];
      days[day].push(entry);
    }
    const byProviderModel = Object.entries(groups).map(([key, entries]) => ({ key, ...aggregateUsage(entries).totals }));
    const daily = Object.entries(days).sort(([left], [right]) => left.localeCompare(right)).map(([date, entries]) => ({ date, ...aggregateUsage(entries).totals }));
    const warning = Boolean(
      (usageMonthlyWarningTokens && aggregate.totals.totalTokens >= usageMonthlyWarningTokens)
      || (usageMonthlyWarningUsd && aggregate.totals.estimatedCostUsd >= usageMonthlyWarningUsd)
    );
    return res.json({
      workspaceCode: context.code, period, from: fromDate.toISOString(), traceId: traceId || null,
      totals: aggregate.totals, byProviderModel, daily, entries: aggregate.entries.slice(0, 100), warning,
      limits: {
        warningTokens: usageMonthlyWarningTokens || null, hardTokens: usageMonthlyHardLimitTokens || null,
        warningUsd: usageMonthlyWarningUsd || null, hardUsd: usageMonthlyHardLimitUsd || null
      },
      pricing: usagePricing
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to read usage ledger") });
  }
});

app.get("/models.csv", (_req, res) => {
  res.sendFile(modelsCsvPath);
});

app.get("/api/tools", (req, res) => {
  const security = getEffectiveSecuritySettingsSync();
  const agentToolNames = agentToolDefinitions.map((tool) => tool.function.name);
  const context = getWorkspaceContext();
  res.json({
    workspaceCode: context.code,
    workspaceRepository: {
      sourceOfTruth: "server-managed workspace",
      autoSessionBranching: enableAutoSessionBranching,
      sessionBranchPrefix,
      lastKnownBranch: workspaceBranchState.get(context.code) || null
    },
    workspaceBackups: {
      enabled: enableNightlyWorkspaceBackup,
      utcHour: workspaceBackupUtcHour,
      retentionDays: workspaceBackupRetentionDays
    },
    agentToolPolicies: agentToolPolicySummary(agentToolDefinitions),
    workspaceGitRemote: {
      remoteName: workspaceGitRemoteName,
      remoteHttpsUrl: getWorkspaceBareRepoHttpsUrl(req, context.code)
    },
    uploadPolicy: {
      defaultMaxBytes: defaultUploadMaxBytes,
      bypassHeader: "X-Upload-Bypass-Code",
      bypassConfiguredForWorkspace: security.workspaceUploadBypassCodes.has(context.code),
      chunked: {
        enabled: true,
        thresholdBytes: chunkUploadThresholdBytes,
        chunkSizeBytes: chunkUploadChunkSizeBytes,
        maxChunkSizeBytes: chunkUploadMaxChunkSizeBytes,
        sessionMaxAgeMs: chunkUploadSessionMaxAgeMs
      }
    },
    agentStepOverridePolicy: {
      enabled: Boolean(security.agentMaxStepsOverrideCode || security.workspaceAgentStepOverrideCodes.size),
      workspaceCodeConfigured: security.workspaceAgentStepOverrideCodes.has(context.code),
      baseMaxSteps: agentMaxSteps,
      maxOverrideSteps: agentMaxStepsOverrideLimit
    },
    imageCapabilities: {
      search: ["wikimedia-commons"],
      generation: [
        ...(openaiApiKey ? [{ provider: "openai", model: openaiImageModel }] : []),
        ...(xaiApiKey ? [{ provider: "xai", model: xaiImageModel }] : []),
        ...(googleApiKey ? [{ provider: "google", model: googleImageModel }] : [])
      ]
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
      allowedDockerImages: terminalRuntime === "docker" ? Array.from(terminalDockerAllowedImages).sort() : [],
      dockerShellCommandLines: terminalRuntime === "docker" ? terminalDockerShellCommandLines : false,
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
      "Optional per-workspace agent step codes override the global high-step unlock only for their workspace.",
      "Nightly workspace backups create git bundle archives and prune backups older than retention policy.",
      "Terminal tool runs with an isolated per-workspace HOME/cache/env and host runtime cannot execute host-admin commands like sudo/apt.",
      "When TERMINAL_RUNTIME=docker, run_terminal command strings execute through sh -lc inside the container, so normal shell syntax like &&, ||, pipes, redirects, multiline backslashes, and flags works.",
      "Docker runtime commands may inspect normal container tool paths like /usr/bin and can use apt-get/dpkg inside the container.",
      "Agents may pass dockerImage to run_terminal or run_build to use an allow-listed cross-build image such as dockcross/windows-static-x64 or mstorsjo/llvm-mingw.",
      "Set TERMINAL_DOCKER_ALLOWED_IMAGES=image1,image2 to add more per-request Docker images without changing code.",
      "Terminal accepts command strings such as `git clone https://github.com/org/repo.git repo`, `cd repo && grep -R TODO .`, and simple conditional chains like `pwd && ls -la && git status 2>&1 || echo no repo`.",
      "Set TERMINAL_EXTRA_COMMANDS=cmd1,cmd2 to add more allow-listed commands from server config.",
      "Archive helpers include 7z and vfa in the terminal allow-list; vfa can resolve from TERMINAL_VFA_COMMAND or TERMINAL_VFA_SCRIPT.",
      "Chat requests support autoCompact=true to send a bounded provider context while preserving the full browser chat archive/history.",
      "Use /api/files/format before /api/files/write when you want prettified output.",
      "Use /api/files/git/log to inspect snapshots and /api/files/git/revert to roll back.",
      "Set agentMode=true with a valid API key in /api/chat to enable automatic tool-calling."
    ],
    agentToolCalling: {
      enabled: true,
      provider: "openai",
      tools: agentToolNames
    },
    agentToolReference: [
      { toolName: "agent_reach_status", description: "Check Agent Reach channel health", whyUseful: "Know which internet backends are live" },
      { toolName: "search_internet", description: "Semantic web search through Exa", whyUseful: "Deeper current web research" },
      { toolName: "search_images", description: "Search Wikimedia Commons with source/license metadata", whyUseful: "Find inspectable reusable imagery" },
      { toolName: "generate_image", description: "Generate workspace imagery with configured providers", whyUseful: "Create visual assets from agent tasks" },
      { toolName: "search_youtube", description: "Search YouTube through yt-dlp", whyUseful: "Find relevant videos" },
      { toolName: "get_youtube_transcript", description: "Extract YouTube captions", whyUseful: "Research and summarize videos" },
      { toolName: "delete_file", description: "Delete file/folder", whyUseful: "Housekeeping control" },
      { toolName: "rename_file", description: "Rename/move files/folders", whyUseful: "Reorganize easily" },
      { toolName: "create_directory", description: "Create new folders", whyUseful: "Structured workspace" },
      { toolName: "zip_unzip", description: "Archive/extract files/folders", whyUseful: "Export/import, backups" },
      { toolName: "run_terminal", description: "Run safe allow-listed terminal commands", whyUseful: "Automation, scripts" },
      { toolName: "run_build", description: "Run build/debug setup profiles", whyUseful: "C/C++/CMake/Python builds" },
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
      { method: "GET", path: "/api/activity?limit=250&category=tool&traceId=...", purpose: "Unified workspace activity across audit, agents, tools, Git, files, shares, recipes, and failures" },
      { method: "POST", path: "/api/chat/subagents/:id/approve", purpose: "Approve and start an exact-path coding child" },
      { method: "PATCH", path: "/api/chat/subagents/:id/acceptance", purpose: "Record selective artifact/context decisions for completed child output", body: { artifacts: { "images/result.png": "accepted" }, context: { 0: "rejected" } } },
      { method: "GET", path: "/api/notifications?limit=100", purpose: "List recent notify_user notifications" },
      { method: "GET", path: "/api/session/workspace/git", purpose: "Get workspace bare git remote path/URL" },
      { method: "POST", path: "/api/session/workspace/git/pull", purpose: "Pull remote branch into workspace", body: { remoteName: "origin", branch: "main", strategy: "ff-only" } },
      { method: "POST", path: "/api/session/workspace/git/push", purpose: "Push workspace branch to remote", body: { remoteName: "origin", branch: "main", setUpstream: true } },
      { method: "GET", path: "/api/files/list?path=src", purpose: "List directory contents" },
      { method: "GET", path: "/api/files/read?path=src/app.js", purpose: "Read UTF-8 text file" },
      { method: "POST", path: "/api/files/write", purpose: "Write file text", body: { path: "src/app.js", content: "..." } },
      { method: "POST", path: "/api/files/upload", purpose: "Upload one or many files (fields: files or file, optional path and relativePaths[])" },
      { method: "GET", path: "/api/files/download?path=src/app.js", purpose: "Download a file or a directory as a zip" },
      { method: "GET", path: "/api/files/shares", purpose: "List retained shares and analytics" },
      { method: "PATCH", path: "/api/files/shares/:id/expiration", purpose: "Extend share expiration", body: { extendByHours: 168 } },
      { method: "POST", path: "/api/files/copy", purpose: "Duplicate file or directory", body: { fromPath: "docs/a.txt", toPath: "docs/a copy.txt" } },
      { method: "POST", path: "/api/files/move", purpose: "Move file or directory", body: { fromPath: "old.txt", toPath: "docs/new.txt" } },
      { method: "POST", path: "/api/files/rename", purpose: "Rename in place", body: { path: "docs/a.txt", newName: "b.txt" } },
      { method: "DELETE", path: "/api/files/delete?path=docs/a.txt", purpose: "Delete file or directory recursively" },
      { method: "POST", path: "/api/files/mkdir", purpose: "Create directory", body: { path: "docs" } },
      { method: "POST", path: "/api/files/format", purpose: "Format text using Prettier", body: { path: "src/app.js", content: "...", write: false } },
      { method: "POST", path: "/api/files/lint", purpose: "Lint JS/TS code with ESLint", body: { path: "src/app.ts", content: "..." } },
      { method: "POST", path: "/api/files/terminal", purpose: "Run allow-listed command in isolated workspace terminal env", body: { command: "git clone https://github.com/org/repo.git repo && git -C repo status", cwd: "", timeoutMs: 120000 } },
      { method: "GET", path: "/api/files/audit?limit=200", purpose: "Read per-operation audit entries" },
      { method: "GET", path: "/api/files/git/log?limit=20", purpose: "List sandbox commits" },
      { method: "GET", path: "/api/files/git/status", purpose: "Structured working tree and branch status" },
      { method: "GET", path: "/api/files/git/change-diff?path=...&staged=false", purpose: "Review a staged or working-tree file diff" },
      { method: "POST", path: "/api/files/git/stage", purpose: "Stage selected files", body: { paths: ["src/app.js"] } },
      { method: "POST", path: "/api/files/git/unstage", purpose: "Unstage selected files", body: { paths: ["src/app.js"] } },
      { method: "POST", path: "/api/files/git/commit", purpose: "Commit staged files", body: { message: "Describe the change" } },
      { method: "GET", path: "/api/operations/health", purpose: "Dependency and bounded runtime metric history" },
      { method: "GET", path: "/api/usage?period=month&traceId=...", purpose: "Workspace provider usage and cost summary" },
      { method: "POST", path: "/api/files/git/revert", purpose: "Hard reset sandbox to a commit", body: { ref: "HEAD~1" } },
      { method: "GET", path: "/api/files/snapshots?limit=30", purpose: "List snapshot commits" },
      { method: "POST", path: "/api/files/snapshots", purpose: "Create manual snapshot commit", body: { message: "checkpoint before refactor" } },
      { method: "POST", path: "/api/files/snapshots/restore", purpose: "Restore sandbox snapshot", body: { ref: "HEAD~1" } },
      { method: "GET", path: "/api/files/diff?left=HEAD~1&right=HEAD&path=...", purpose: "Diff two refs for optional path" },
      { method: "POST", path: "/api/files/diff/paths", purpose: "Diff two sandbox paths", body: { leftPath: "a.txt", rightPath: "b.txt" } },
      { method: "POST", path: "/api/files/merge/from-snapshot", purpose: "Merge path from snapshot into workspace", body: { ref: "HEAD~1", path: "src/app.js" } },
      { method: "GET", path: "/api/files/search?q=term&mode=hybrid&path=src", purpose: "Full-text and semantic search in sandbox files" },
      { method: "GET", path: "/api/files/code-map?path=src&refresh=false", purpose: "Build or read a cached workspace symbols/imports code map" },
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
      "/api/files/download": { get: { summary: "Download file or directory zip" } },
      "/api/files/shares": { get: { summary: "List file shares with analytics" }, post: { summary: "Create file share" } },
      "/api/files/shares/{id}/expiration": { patch: { summary: "Extend file share expiration" } },
      "/api/files/copy": { post: { summary: "Duplicate path" } },
      "/api/files/move": { post: { summary: "Move path" } },
      "/api/files/rename": { post: { summary: "Rename path" } },
      "/api/files/delete": { delete: { summary: "Delete path" } },
      "/api/files/mkdir": { post: { summary: "Create directory" } },
      "/api/files/format": { post: { summary: "Format text" } },
      "/api/files/lint": { post: { summary: "Lint text" } },
      "/api/files/terminal": { post: { summary: "Run safe terminal command" } },
      "/api/files/audit": { get: { summary: "List audit entries" } },
      "/api/files/git/log": { get: { summary: "List git commits" } },
      "/api/files/git/status": { get: { summary: "Get structured Git status" } },
      "/api/files/git/change-diff": { get: { summary: "Get file change diff" } },
      "/api/files/git/stage": { post: { summary: "Stage selected files" } },
      "/api/files/git/unstage": { post: { summary: "Unstage selected files" } },
      "/api/files/git/commit": { post: { summary: "Commit staged files" } },
      "/api/files/git/branch": { post: { summary: "Switch or create branch" } },
      "/api/files/git/conflict": { post: { summary: "Resolve a conflicted file" } },
      "/api/files/git/revert": { post: { summary: "Revert sandbox git state" } },
      "/api/operations/health": { get: { summary: "Get live health and runtime history" } },
      "/api/usage": { get: { summary: "Get workspace usage and cost totals" } },
      "/api/files/snapshots": {
        get: { summary: "List snapshots" },
        post: { summary: "Create snapshot" }
      },
      "/api/files/snapshots/restore": { post: { summary: "Restore snapshot" } },
      "/api/files/diff": { get: { summary: "Diff refs" } },
      "/api/files/diff/paths": { post: { summary: "Diff paths" } },
      "/api/files/merge/from-snapshot": { post: { summary: "Merge file from snapshot" } },
  "/api/files/search": { get: { summary: "Search sandbox" } },
  "/api/files/code-map": { get: { summary: "Build or read cached workspace code map" } },
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
    const result = await getFileList(req.query.path || "");
    await appendAuditLog(req, "list", { path: result.path, count: result.entries.length });
    return res.json(result);
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
    await commitSandboxSnapshot(`write ${rel || "."}`, [rel]);
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
    await cleanupExpiredUploadSessionFiles();
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

    const requestedChunkSizeValue = Number(req.body?.chunkSizeBytes || chunkUploadChunkSizeBytes);
    const requestedChunkSize = Number.isFinite(requestedChunkSizeValue) ? requestedChunkSizeValue : chunkUploadChunkSizeBytes;
    const selectedChunkSize = Math.max(256 * 1024, Math.min(chunkUploadMaxChunkSizeBytes, requestedChunkSize));
    const totalChunks = Math.max(1, Math.ceil(size / selectedChunkSize));
    const session = {
      id: uploadId,
      workspaceCode: getWorkspaceContext().code,
      targetRel,
      targetPath,
      tempPath,
      expectedSize: size,
      chunkSizeBytes: selectedChunkSize,
      totalChunks,
      nextChunkIndex: 0,
      receivedBytes: 0,
      updatedAt: Date.now()
    };
    uploadSessionStore.set(uploadId, session);
    await persistUploadSession(session);

    return res.json({
      ok: true,
      workspaceCode: getWorkspaceContext().code,
      uploadId,
      path: targetRel,
      chunkSizeBytes: selectedChunkSize,
      totalChunks
    });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to start chunk upload") });
  }
});

app.post("/api/files/upload/chunk/:uploadId", express.raw({ type: "application/octet-stream", limit: `${Math.max(1, Math.ceil(chunkUploadMaxChunkSizeBytes / (1024 * 1024)) + 2)}mb` }), async (req, res) => {
  try {
    const uploadId = String(req.params.uploadId || "").trim();
    if (!uploadId) {
      return res.status(400).json({ error: "uploadId is required" });
    }

    const chunkIndex = Number(req.query?.index);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ error: "chunk index must be a non-negative integer" });
    }

    const session = await getUploadSessionOrThrow(uploadId);
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
    await persistUploadSession(session);

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

    const session = await getUploadSessionOrThrow(uploadId);
    return res.json({
      ok: true,
      workspaceCode: getWorkspaceContext().code,
      uploadId,
      path: session.targetRel,
      expectedSize: session.expectedSize,
      chunkSizeBytes: session.chunkSizeBytes,
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

    const session = await getUploadSessionOrThrow(uploadId);
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
    await fsp.unlink(getUploadSessionMetadataPath(uploadId)).catch(() => {});

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
      const { zipPath, zipName, tempDir } = await createDirectoryDownloadZip(absolute, rel);
      await appendAuditLog(req, "download-directory", { path: rel || ".", archive: zipName });
      return res.download(zipPath, zipName, async (error) => {
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        if (error && !res.headersSent) {
          res.status(500).json({ error: "Failed to download directory" });
        }
      });
    }
    await appendAuditLog(req, "download", { path: rel, size: stat.size });
    return res.download(absolute, path.basename(rel || absolute));
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to download path") });
  }
});

app.get("/api/files/video-preview", async (req, res) => {
  try {
    const preview = await getBrowserVideoPreview(req.query.path || "", { waitForReady: req.method !== "HEAD" });
    if (preview.preparing) {
      res.setHeader("Retry-After", "2");
      return res.status(202).end();
    }
    res.setHeader("Content-Type", preview.transcoded ? "video/mp4" : fileShareMimeType(preview.rel));
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(preview.rel).replaceAll('"', '')}"`);
    return res.sendFile(preview.absolute);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to prepare video preview") });
  }
});

app.get("/api/files/media-preview", async (req, res) => {
  try {
    const preview = shouldConvertImage(req.query.path || "")
      ? await getBrowserImagePreview(req.query.path || "")
      : (() => {
          const { absolute, rel } = resolveSandboxPath(req.query.path || "");
          return { absolute, rel, converted: false };
        })();
    const stat = await fsp.stat(preview.absolute);
    if (!stat.isFile()) return res.status(400).json({ error: "media preview path must be a file" });
    res.setHeader("Content-Type", preview.converted ? "image/png" : fileShareMimeType(preview.rel));
    res.setHeader("Content-Disposition", `inline; filename="${path.basename(preview.rel).replaceAll('"', '')}"`);
    return res.sendFile(preview.absolute);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to stream media preview") });
  }
});

app.get("/api/files/shares", async (req, res) => {
  try {
    const db = await readFileShareDb();
    const workspaceCode = getWorkspaceContext().code;
    const activeShares = db.shares
      .filter((share) => share.workspaceCode === workspaceCode && !share.revokedAt)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    const publicBaseUrl = getPublicBaseUrl(req);
    const shares = await Promise.all(activeShares.map((share) => publicFileShareRecordWithUrls(share, publicBaseUrl)));
    return res.json({ shares });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || "Failed to list file shares") });
  }
});

app.post("/api/files/shares", async (req, res) => {
  let encryptedPath = "";
  try {
    const { absolute, rel } = resolveSandboxPath(req.body?.path || "");
    const stat = await fsp.stat(absolute);
    if (!stat.isFile()) return res.status(400).json({ error: "Only files can be shared" });

    const expiresInHours = Number(req.body?.expiresInHours ?? 168);
    if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 8760) {
      return res.status(400).json({ error: "Expiration must be between 1 and 8760 hours" });
    }
    const password = String(req.body?.password || "");
    if (password.length > 256) return res.status(400).json({ error: "Password is too long" });
    const encrypted = Boolean(req.body?.encrypted);
    if (encrypted && !fileShareEncryptionSecret) {
      return res.status(400).json({ error: "Encrypted shares require FILE_SHARE_ENCRYPTION_SECRET on the server" });
    }

    const token = randomBytes(32).toString("base64url");
    const id = randomBytes(12).toString("hex");
    const passwordSalt = password ? randomBytes(16) : null;
    const passwordHash = password ? await scryptBuffer(password, passwordSalt) : null;
    const share = {
      id,
      tokenHash: fileShareTokenHash(token),
      ...await encryptFileShareToken(token),
      ...await encryptFileSharePassword(password),
      workspaceCode: getWorkspaceContext().code,
      relativePath: rel,
      fileName: path.basename(rel || absolute),
      size: stat.size,
      mimeType: fileShareMimeType(rel),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
      passwordSalt: passwordSalt?.toString("hex") || "",
      passwordHash: passwordHash?.toString("hex") || "",
      encrypted,
      accessCount: 0,
      viewCount: 0,
      downloadCount: 0
    };

    if (encrypted) {
      await fsp.mkdir(fileShareDataRoot, { recursive: true });
      const salt = randomBytes(16);
      const iv = randomBytes(12);
      const key = await scryptBuffer(fileShareEncryptionSecret, salt);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encryptedFile = `${id}.enc`;
      encryptedPath = path.join(fileShareDataRoot, encryptedFile);
      await pipeline(fs.createReadStream(absolute), cipher, fs.createWriteStream(encryptedPath, { mode: 0o600 }));
      share.encryptedFile = encryptedFile;
      share.encryptionSalt = salt.toString("hex");
      share.encryptionIv = iv.toString("hex");
      share.encryptionTag = cipher.getAuthTag().toString("hex");
    }

    const db = await readFileShareDb();
    db.shares.push(share);
    await writeFileShareDb(db);
    await appendAuditLog(req, "create-file-share", { path: rel, shareId: id, encrypted, expiresAt: share.expiresAt });
    const baseUrl = getPublicBaseUrl(req);
    return res.status(201).json({
      share: publicFileShareRecord(share),
      viewUrl: `${baseUrl}/share/${token}`,
      directUrl: `${baseUrl}/share/${token}/content`
    });
  } catch (error) {
    if (encryptedPath) await fsp.unlink(encryptedPath).catch(() => {});
    return res.status(400).json({ error: String(error?.message || "Failed to create file share") });
  }
});

app.delete("/api/files/shares/:id", async (req, res) => {
  try {
    const db = await readFileShareDb();
    const share = db.shares.find((item) => item.id === req.params.id && item.workspaceCode === getWorkspaceContext().code && !item.revokedAt);
    if (!share) return res.status(404).json({ error: "File share not found" });
    share.revokedAt = new Date().toISOString();
    await writeFileShareDb(db);
    if (share.encryptedFile) await fsp.unlink(resolveSharedSourcePath(share)).catch(() => {});
    await appendAuditLog(req, "revoke-file-share", { path: share.relativePath, shareId: share.id });
    return res.json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to revoke file share") });
  }
});

app.patch("/api/files/shares/:id/expiration", async (req, res) => {
  try {
    const db = await readFileShareDb();
    const share = db.shares.find((item) => item.id === req.params.id && item.workspaceCode === getWorkspaceContext().code && !item.revokedAt);
    if (!share) return res.status(404).json({ error: "File share not found" });
    const previousExpiresAt = share.expiresAt;
    share.expiresAt = extendShareExpiration(share.expiresAt, req.body?.extendByHours ?? 168);
    await writeFileShareDb(db);
    await appendAuditLog(req, "extend-file-share", {
      path: share.relativePath,
      shareId: share.id,
      previousExpiresAt,
      expiresAt: share.expiresAt
    });
    return res.json({ ok: true, share: publicFileShareRecord(share) });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to extend file share") });
  }
});

app.post("/api/files/copy", async (req, res) => {
  try {
    const result = await copySandboxPath(req.body?.fromPath || "", req.body?.toPath || "");
    await appendAuditLog(req, "copy", { fromPath: result.fromPath, toPath: result.toPath, type: result.type });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to duplicate path") });
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
      req.body?.timeoutMs,
      { dockerImage: req.body?.dockerImage }
    );

    await appendAuditLog(req, "terminal", {
      command: result.command,
      cwd: result.cwd,
      dockerImage: result.dockerImage || null,
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

app.get("/api/files/git/status", async (req, res) => {
  try {
    return res.json(await getGitChangeCenterStatus());
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to read Git status") });
  }
});

app.get("/api/files/git/change-diff", async (req, res) => {
  try {
    const [targetPath] = selectedGitChangePaths(req.query.path);
    const staged = String(req.query.staged || "false").toLowerCase() === "true";
    const args = ["diff", "--no-ext-diff", "--no-color", ...(staged ? ["--cached"] : []), "--", targetPath];
    const result = await runGit(args, true);
    return res.json({ path: targetPath, staged, diff: String(result.stdout || "").slice(0, 750_000) });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to read Git diff") });
  }
});

app.post("/api/files/git/stage", async (req, res) => {
  try {
    const paths = selectedGitChangePaths(req.body?.paths);
    await runGit(["add", "--", ...paths]);
    await appendAuditLog(req, "git-stage", { paths });
    return res.json({ ok: true, status: await getGitChangeCenterStatus() });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to stage files") });
  }
});

app.post("/api/files/git/unstage", async (req, res) => {
  try {
    const paths = selectedGitChangePaths(req.body?.paths);
    const result = await runGit(["restore", "--staged", "--", ...paths], true);
    if (result.code) throw new Error(String(result.stderr || "Failed to unstage files"));
    await appendAuditLog(req, "git-unstage", { paths });
    return res.json({ ok: true, status: await getGitChangeCenterStatus() });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to unstage files") });
  }
});

app.post("/api/files/git/commit", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message || message.length > 240 || /[\r\n]/.test(message)) return res.status(400).json({ error: "Commit message must be 1 to 240 characters on one line" });
    const result = await runGit(["commit", "-m", message], true);
    if (result.code) throw new Error(String(result.stderr || result.stdout || "Git commit failed"));
    const hash = String((await runGit(["rev-parse", "--short", "HEAD"])).stdout || "").trim();
    await appendAuditLog(req, "git-commit", { message, hash });
    return res.json({ ok: true, hash, output: String(result.stdout || "").trim(), status: await getGitChangeCenterStatus() });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to commit changes") });
  }
});

app.post("/api/files/git/branch", async (req, res) => {
  try {
    const branch = await switchWorkspaceBranch(req.body?.branch, Boolean(req.body?.create));
    await appendAuditLog(req, "git-branch-switch", { branch, create: Boolean(req.body?.create) });
    return res.json({ ok: true, branch, status: await getGitChangeCenterStatus() });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to switch branch") });
  }
});

app.post("/api/files/git/conflict", async (req, res) => {
  try {
    const [targetPath] = selectedGitChangePaths(req.body?.path);
    const strategy = String(req.body?.strategy || "").trim().toLowerCase();
    const status = await getGitChangeCenterStatus();
    if (!status.files.some((item) => item.path === targetPath && item.conflict)) return res.status(409).json({ error: "File is not currently conflicted" });
    if (strategy === "ours" || strategy === "theirs") await runGit(["checkout", `--${strategy}`, "--", targetPath]);
    else if (strategy !== "mark-resolved") return res.status(400).json({ error: "Strategy must be ours, theirs, or mark-resolved" });
    await runGit(["add", "--", targetPath]);
    await appendAuditLog(req, "git-conflict-resolve", { path: targetPath, strategy });
    return res.json({ ok: true, status: await getGitChangeCenterStatus() });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to resolve conflict") });
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
    const caseSensitive = String(req.query.caseSensitive || "").toLowerCase() === "true";
    const result = await searchSandboxContent({ query, mode, path: targetPath, limit, caseSensitive });
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

app.get("/api/files/code-map", async (req, res) => {
  try {
    const targetPath = String(req.query.path || "").trim();
    const refresh = String(req.query.refresh || "").toLowerCase() === "true";
    const { absolute, rel } = resolveSandboxPath(targetPath);
    const stat = await fsp.stat(absolute);
    if (!stat.isDirectory()) return res.status(400).json({ error: "code-map path must be a directory" });
    const cacheKey = `${getWorkspaceContext().code}:${rel || "."}`;
    let map = refresh ? null : codeMapCache.get(cacheKey);
    if (!map) {
      map = await buildCodeMap(absolute);
      codeMapCache.set(cacheKey, map);
    }
    await appendAuditLog(req, "code-map", { path: rel, refreshed: refresh, ...codeMapSummary(map) });
    return res.json({ ok: true, path: rel, cached: !refresh && codeMapCache.has(cacheKey), ...map, summary: codeMapSummary(map) });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to build code map") });
  }
});

app.post("/api/files/search/replace-preview", async (req, res) => {
  try {
    const targetPath = String(req.body?.path || "").trim();
    const { absolute: baseAbs, rel: baseRel } = resolveSandboxPath(targetPath);
    const result = await previewWorkspaceReplacements(getSandboxRoot(), baseAbs, req.body || {});
    await appendAuditLog(req, "search-replace-preview", {
      path: baseRel,
      filesScanned: result.filesScanned,
      filesMatched: result.filesMatched,
      replacementCount: result.replacementCount
    });
    return res.json({ ok: true, path: baseRel, ...result });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to preview replacements") });
  }
});

app.post("/api/files/search/replace", async (req, res) => {
  try {
    const targetPath = String(req.body?.path || "").trim();
    const acceptedPaths = Array.isArray(req.body?.acceptedPaths) ? req.body.acceptedPaths : [];
    const { absolute: baseAbs, rel: baseRel } = resolveSandboxPath(targetPath);
    const result = await applyWorkspaceReplacements(getSandboxRoot(), baseAbs, acceptedPaths, req.body || {});
    if (result.filesChanged > 0) {
      await commitSandboxSnapshot(`search replace ${baseRel || "."} (${result.replacementCount})`, result.changedFiles);
    }
    await appendAuditLog(req, "search-replace", {
      path: baseRel,
      filesChanged: result.filesChanged,
      replacementCount: result.replacementCount,
      changedFiles: result.changedFiles
    });
    return res.json({ ok: true, path: baseRel, ...result });
  } catch (error) {
    return res.status(400).json({ error: String(error?.message || "Failed to apply replacements") });
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

app.use("/vendor/katex", express.static(path.join(projectRoot, "node_modules", "katex", "dist"), {
  fallthrough: false,
  immutable: true,
  maxAge: "30d"
}));
app.use(express.static(publicDir));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

await ensureSandboxReady();
await loadAdminSecuritySettings();
await loadChatJobState();
await loadAgentRecipeSchedules();
scheduleNightlyWorkspaceBackups();
queueMicrotask(dispatchChatJobs);

app.listen(port, host, () => {
  console.log(`Remote AI Access listening on ${host}:${port} (${appBaseUrl})`);
});
