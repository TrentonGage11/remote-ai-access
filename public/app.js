const tabListEl = document.getElementById("tabList");
const newChatBtnEl = document.getElementById("newChatBtn");
const messageListEl = document.getElementById("messageList");
const promptEl = document.getElementById("prompt");
const sendBtnEl = document.getElementById("sendBtn");
const cancelJobBtnEl = document.getElementById("cancelJobBtn");
const statusEl = document.getElementById("status");
const themeToggleEl = document.getElementById("themeToggle");
const providerSelectEl = document.getElementById("providerSelect");
const modelSelectEl = document.getElementById("modelSelect");
const reasoningEffortFieldEl = document.getElementById("reasoningEffortField");
const reasoningEffortSelectEl = document.getElementById("reasoningEffortSelect");
const agentModeToggleEl = document.getElementById("agentModeToggle");
const agentStepOverrideInputEl = document.getElementById("agentStepOverrideInput");
const agentStepOverrideCodeInputEl = document.getElementById("agentStepOverrideCodeInput");
const chatPanelEl = document.getElementById("chatPanel");
const contextScopeSelectEl = document.getElementById("contextScopeSelect");
const contextListEl = document.getElementById("contextList");
const contextStatusEl = document.getElementById("contextStatus");
const contextManagerSummaryEl = document.getElementById("contextManagerSummary");
const persistedDisclosureEls = document.querySelectorAll("[data-disclosure-storage-key]");
const addContextEntryBtnEl = document.getElementById("addContextEntryBtn");
const copyContextPreambleBtnEl = document.getElementById("copyContextPreambleBtn");
const copyAllAssistantBtnEl = document.getElementById("copyAllAssistantBtn");
const refreshRenderBtnEl = document.getElementById("refreshRenderBtn");
const repairChatStateBtnEl = document.getElementById("repairChatStateBtn");
const refreshToolRunsBtnEl = document.getElementById("refreshToolRunsBtn");
const toolRunsListEl = document.getElementById("toolRunsList");
const toolRunsFilterSelectEl = document.getElementById("toolRunsFilterSelect");
const notificationToggleEl = document.getElementById("notificationToggle");
const notificationSoundToggleEl = document.getElementById("notificationSoundToggle");
const notifyInfoToggleEl = document.getElementById("notifyInfoToggle");
const notifySuccessToggleEl = document.getElementById("notifySuccessToggle");
const notifyWarningToggleEl = document.getElementById("notifyWarningToggle");
const notifyErrorToggleEl = document.getElementById("notifyErrorToggle");
const notifyDebounceInputEl = document.getElementById("notifyDebounceInput");
const workspaceCodeInputEl = document.getElementById("workspaceCodeInput");
const workspaceSwitchBtnEl = document.getElementById("workspaceSwitchBtn");
const workspaceBadgeEl = document.getElementById("workspaceBadge");
const traceStatusChipEl = document.getElementById("traceStatusChip");
const openTraceAuditBtnEl = document.getElementById("openTraceAuditBtn");
const copyTraceBtnEl = document.getElementById("copyTraceBtn");
const copyTraceAuditUrlBtnEl = document.getElementById("copyTraceAuditUrlBtn");
const autoOpenTraceAuditToggleEl = document.getElementById("autoOpenTraceAuditToggle");

const THEME_STORAGE_KEY = "remote-ai-access-theme";
const FILELAB_SYNTAX_THEME_KEY = "filelab-syntax-theme";
const CHAT_STATE_KEY = "remote-ai-access-chat-state-v1";
const HISTORY_EXPORT_KEY = "remote-ai-access-history-v1";
const CHAT_BACKUPS_KEY = "remote-ai-access-chat-backups-v1";
const CONTEXT_GLOBAL_KEY = "remote-ai-access-context-global-v1";
const CONTEXT_PREAMBLE_MAX_CHARS = 8000;
const CONTEXT_MAX_ENTRIES = 60;
const LEGACY_CHAT_STATE_KEYS = [
  "remote-ai-access-chat-state",
  "remote-ai-access-chat-state-v0",
  "remote-ai-access-history",
  "remote-ai-access-history-v0"
];
const AGENT_MODE_STORAGE_KEY = "remote-ai-access-agent-mode-v1";
const TOOL_RUNS_FILTER_STORAGE_KEY = "remote-ai-access-tool-runs-filter-v1";
const LAST_SEEN_NOTIFICATION_ID_KEY = "remote-ai-access-last-seen-notification-id-v1";
const NOTIFICATIONS_ENABLED_KEY = "remote-ai-access-notifications-enabled-v1";
const NOTIFICATIONS_SOUND_ENABLED_KEY = "remote-ai-access-notifications-sound-enabled-v1";
const NOTIFICATIONS_LEVELS_KEY = "remote-ai-access-notifications-levels-v1";
const NOTIFICATIONS_DEBOUNCE_MS_KEY = "remote-ai-access-notifications-debounce-ms-v1";
const NOTIFICATION_RULES_KEY = "remote-ai-access-notification-rules-v1";
const AUTO_OPEN_TRACE_AUDIT_KEY = "remote-ai-access-auto-open-trace-audit-v1";

const FALLBACK_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.3-codex", "gpt-5", "gpt-4.1"];
const CHAT_CAPABLE_TYPES = new Set(["text", "code", "chatgpt", "research", "open-weight", "search", "tool"]);
const SUPPORTED_CODE_THEMES = new Set(["verdant", "cyberpunk-hc", "ember", "oceanic", "mono", "preparing"]);
const GENERIC_CODE_KEYWORDS = [
  "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
  "try", "catch", "finally", "throw", "throws", "new", "class", "interface", "extends", "implements",
  "public", "private", "protected", "static", "const", "let", "var", "function", "async", "await",
  "import", "export", "from", "as", "type", "enum", "struct", "trait", "fn", "def", "lambda",
  "true", "false", "null", "none", "undefined", "this", "super", "yield"
];

let config = {
  defaultProvider: "openai",
  defaultModel: "gpt-4.1",
  xaiDefaultModel: "grok-4.6",
  allowedModels: [],
  xaiAllowedModels: [],
  supportedProviders: ["openai"],
  agentModeSupportedProviders: ["openai"],
  agentStepOverride: {
    enabled: false,
    baseMaxSteps: 16,
    maxOverrideSteps: 40
  },
  chatCompaction: {
    enabled: true,
    messageMaxChars: 8000,
    contextMaxChars: 32000
  }
};

let modelCatalog = [];
let state = loadState();
let notificationPollTimer = null;
let notificationTitleFlashTimer = null;
let notificationTitleFlashEndsAt = 0;
let notificationToastContainer = null;
let lastNotificationShownAt = 0;
const recentlyShownNotificationKeys = new Map();
const notificationRuleLastRunAt = new Map();
let activeChatJob = null;
let currentTraceId = "";
let failedRetryTarget = { chatId: "", messageId: "" };
let contextScope = "chat";
let lastContextDirectiveCount = 0;

function autoOpenTraceAuditEnabled() {
  return localStorage.getItem(AUTO_OPEN_TRACE_AUDIT_KEY) === "true";
}

function getFilteredAuditUrl(traceId) {
  const normalized = String(traceId || "").trim();
  if (!normalized) {
    return "audit.html";
  }
  const params = new URLSearchParams();
  params.set("operation", "agent-tool-record");
  params.set("traceId", normalized);
  params.set("limit", "200");
  return `audit.html?${params.toString()}`;
}

function maybeAutoOpenFilteredAudit(traceId) {
  if (!autoOpenTraceAuditEnabled()) {
    return;
  }
  const url = getFilteredAuditUrl(traceId);
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    statusEl.textContent = "Auto-open audit was blocked by your browser popup settings.";
  }
}

function updateTracePanel(traceId, status = "") {
  currentTraceId = String(traceId || "").trim();
  if (traceStatusChipEl) {
    traceStatusChipEl.textContent = currentTraceId
      ? `${currentTraceId}${status ? ` (${status})` : ""}`
      : "No trace yet";
  }

  if (openTraceAuditBtnEl) {
    openTraceAuditBtnEl.href = getFilteredAuditUrl(currentTraceId);
  }
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChat(overrides = {}) {
  return {
    id: uid(),
    title: "New chat",
    provider: config.defaultProvider,
    model: config.defaultModel,
    reasoningEffort: "",
    createdAt: new Date().toISOString(),
    messages: [],
    ...overrides
  };
}

function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeReasoningEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  if (!effort) {
    return "";
  }
  return /^[a-z][a-z0-9_-]{1,15}$/.test(effort) ? effort : "";
}

function normalizeWorkspaceCode(value) {
  const code = String(value || "").trim().toLowerCase();
  if (!code) {
    return "";
  }
  return /^[a-z0-9][a-z0-9_-]{1,47}$/.test(code) ? code : "";
}

function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function storageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function normalizeMessageRecord(msg) {
  if (!msg || (msg.role !== "user" && msg.role !== "assistant") || typeof msg.content !== "string") {
    return null;
  }
  return {
    ...msg,
    id: typeof msg.id === "string" && msg.id ? msg.id : uid(),
    role: msg.role,
    content: msg.content,
    createdAt: typeof msg.createdAt === "string" && msg.createdAt ? msg.createdAt : new Date().toISOString(),
    traceId: typeof msg.traceId === "string" ? msg.traceId : "",
    executedTools: Array.isArray(msg.executedTools)
      ? msg.executedTools.filter((item) => typeof item === "string")
      : [],
    contextCompaction: msg.contextCompaction && typeof msg.contextCompaction === "object"
      ? msg.contextCompaction
      : null
  };
}

function normalizeChatRecord(chat) {
  if (!chat || typeof chat !== "object") {
    return null;
  }

  const provider = normalizeProvider(chat.provider) || config.defaultProvider || "openai";
  const model = typeof chat.model === "string" && chat.model
    ? chat.model
    : (provider === "xai" ? (config.xaiDefaultModel || "grok-4.6") : (config.defaultModel || "gpt-4.1"));

  const messages = Array.isArray(chat.messages)
    ? chat.messages
      .map((msg) => normalizeMessageRecord(msg))
      .filter(Boolean)
    : [];

  return {
    ...chat,
    id: typeof chat.id === "string" && chat.id ? chat.id : uid(),
    title: typeof chat.title === "string" && chat.title ? chat.title : "New chat",
    provider,
    model,
    reasoningEffort: normalizeReasoningEffort(chat.reasoningEffort),
    agentMaxStepsOverride: Number.isInteger(Number(chat.agentMaxStepsOverride)) ? Number(chat.agentMaxStepsOverride) : null,
    agentMaxStepsOverrideCode: typeof chat.agentMaxStepsOverrideCode === "string" ? chat.agentMaxStepsOverrideCode : "",
    contextEntries: normalizeContextEntries(chat.contextEntries),
    createdAt: typeof chat.createdAt === "string" && chat.createdAt ? chat.createdAt : new Date().toISOString(),
    messages
  };
}

function ensureStateIntegrity() {
  const source = state && Array.isArray(state.chats) ? state : { activeChatId: "", chats: [] };
  let chats = source.chats
    .map((chat) => normalizeChatRecord(chat))
    .filter(Boolean);

  if (chats.length === 0) {
    chats = [createChat()];
  }

  const activeId = typeof source.activeChatId === "string" ? source.activeChatId : "";
  const activeExists = chats.some((chat) => chat.id === activeId);
  state = {
    activeChatId: activeExists ? activeId : chats[0].id,
    chats
  };
  return state;
}

async function loadWorkspaceInfo() {
  if (!workspaceBadgeEl) {
    return;
  }
  try {
    const response = await fetch("/api/session/workspace", { cache: "no-store" });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Failed to load workspace");
    }

    const code = normalizeWorkspaceCode(data?.workspaceCode) || "default";
    workspaceBadgeEl.textContent = `Workspace: ${code}`;
    if (workspaceCodeInputEl && !workspaceCodeInputEl.value) {
      workspaceCodeInputEl.value = code;
    }
  } catch {
    workspaceBadgeEl.textContent = "Workspace: unknown";
  }
}

async function switchWorkspace() {
  if (!workspaceCodeInputEl) {
    return;
  }

  const code = normalizeWorkspaceCode(workspaceCodeInputEl.value);
  if (!code) {
    statusEl.textContent = "Workspace code must use letters, numbers, _ or -.";
    return;
  }

  workspaceSwitchBtnEl.disabled = true;
  try {
    const response = await fetch("/api/session/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: code })
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Failed to switch workspace");
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("access_code");
    window.location.replace(url.toString());
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    workspaceSwitchBtnEl.disabled = false;
  }
}

function normalizeStateShape(parsed) {
  if (!Array.isArray(parsed?.chats) || parsed.chats.length === 0) {
    return null;
  }

  const chats = parsed.chats
    .map((chat) => normalizeChatRecord(chat))
    .filter(Boolean);
  if (chats.length === 0) {
    return null;
  }

  const activeExists = chats.some((chat) => chat.id === parsed.activeChatId);
  return {
    activeChatId: activeExists ? parsed.activeChatId : chats[0].id,
    chats
  };
}

function parseStateJson(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    return normalizeStateShape(JSON.parse(raw));
  } catch {
    return null;
  }
}

function countMessages(chatState) {
  if (!chatState || !Array.isArray(chatState.chats)) {
    return 0;
  }
  return chatState.chats.reduce((total, chat) => total + (Array.isArray(chat.messages) ? chat.messages.length : 0), 0);
}

function chooseBestState(candidates) {
  const valid = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (valid.length === 0) {
    return null;
  }

  valid.sort((a, b) => {
    const msgDelta = countMessages(b) - countMessages(a);
    if (msgDelta !== 0) {
      return msgDelta;
    }
    return (b.chats?.length || 0) - (a.chats?.length || 0);
  });

  return valid[0] || null;
}

function getPersistedStateCandidates() {
  const candidates = [];

  const primary = parseStateJson(storageGet(CHAT_STATE_KEY));
  if (primary) {
    candidates.push(primary);
  }

  const exportState = parseStateJson(storageGet(HISTORY_EXPORT_KEY));
  if (exportState) {
    candidates.push(exportState);
  }

  for (const key of LEGACY_CHAT_STATE_KEYS) {
    const legacy = parseStateJson(storageGet(key));
    if (legacy) {
      candidates.push(legacy);
    }
  }

  try {
    const backupsRaw = storageGet(CHAT_BACKUPS_KEY);
    const backups = JSON.parse(backupsRaw || "[]");
    if (Array.isArray(backups)) {
      for (const item of backups) {
        const restored = normalizeStateShape(item?.state);
        if (restored) {
          candidates.push(restored);
        }
      }
    }
  } catch {
    // Ignore unreadable backup blobs.
  }

  return candidates;
}

function persistBackupSnapshot(rawStateJson) {
  if (!rawStateJson) {
    return;
  }

  const parsed = parseStateJson(rawStateJson);
  if (!parsed || countMessages(parsed) === 0) {
    return;
  }

  const checksum = String(rawStateJson).slice(0, 4096);
  const nextEntry = {
    timestamp: new Date().toISOString(),
    checksum,
    state: parsed
  };

  let backups = [];
  try {
    const existing = JSON.parse(storageGet(CHAT_BACKUPS_KEY) || "[]");
    backups = Array.isArray(existing) ? existing : [];
  } catch {
    backups = [];
  }

  const alreadyExists = backups.some((item) => item?.checksum === checksum);
  if (!alreadyExists) {
    backups.unshift(nextEntry);
    backups = backups.slice(0, 15);
    storageSet(CHAT_BACKUPS_KEY, JSON.stringify(backups));
  }
}

function loadState() {
  const best = chooseBestState(getPersistedStateCandidates());
  if (best) {
    return best;
  }

  const starter = createChat();
  return { activeChatId: starter.id, chats: [starter] };
}

function saveState() {
  ensureStateIntegrity();
  persistBackupSnapshot(storageGet(CHAT_STATE_KEY));
  persistBackupSnapshot(storageGet(HISTORY_EXPORT_KEY));

  const persistedBest = chooseBestState(getPersistedStateCandidates());
  const currentCount = countMessages(state);
  const persistedCount = countMessages(persistedBest);

  if (currentCount === 0 && persistedCount > 0) {
    state = persistedBest;
  }

  const compactJson = JSON.stringify(state);
  if (storageSet(CHAT_STATE_KEY, compactJson)) {
    // Keep pretty export as best-effort only; it's the largest quota consumer.
    if (!storageSet(HISTORY_EXPORT_KEY, JSON.stringify(state, null, 2))) {
      storageRemove(HISTORY_EXPORT_KEY);
    }
    return;
  }

  // Last-resort recovery when quota is exhausted.
  storageRemove(CHAT_BACKUPS_KEY);
  storageRemove(HISTORY_EXPORT_KEY);
  if (!storageSet(CHAT_STATE_KEY, compactJson)) {
    console.warn("Failed to persist chat state: browser storage is full or unavailable.");
    if (statusEl) {
      statusEl.textContent = "Warning: chat history could not be saved (browser storage full/unavailable).";
    }
  }
}

function repairChatStateFromStorage() {
  const best = chooseBestState(getPersistedStateCandidates());
  if (best) {
    state = best;
  } else {
    const starter = createChat();
    state = { activeChatId: starter.id, chats: [starter] };
  }

  ensureStateIntegrity();
  saveState();
  renderAll();
  const chatCount = state.chats.length;
  const messageCount = countMessages(state);
  statusEl.textContent = `Chat state repaired. ${chatCount} chat(s), ${messageCount} message(s).`;
}

function getActiveChat() {
  ensureStateIntegrity();
  return state.chats.find((chat) => chat.id === state.activeChatId) || state.chats[0];
}

function getChatById(chatId) {
  ensureStateIntegrity();
  return state.chats.find((chat) => chat.id === chatId) || null;
}

function getLatestUserMessageId(chat) {
  if (!chat || !Array.isArray(chat.messages)) {
    return "";
  }
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    if (chat.messages[index]?.role === "user") {
      return String(chat.messages[index].id || "");
    }
  }
  return "";
}

function clearFailedRetryTarget() {
  failedRetryTarget = { chatId: "", messageId: "" };
}

function setFailedRetryTarget(chatId, messageId) {
  failedRetryTarget = {
    chatId: String(chatId || ""),
    messageId: String(messageId || "")
  };
}

function formatTime(isoTime) {
  try {
    return new Date(isoTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function shortTitleFromMessage(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}...` : oneLine;
}

function middleTruncate(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) {
    return value;
  }
  const marker = `\n\n[... ${value.length - maxChars} characters retained in full local history ...]\n\n`;
  const remaining = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(remaining * 0.55);
  const tail = Math.max(0, remaining - head);
  return `${value.slice(0, head)}${marker}${tail > 0 ? value.slice(-tail) : ""}`;
}

function buildPayloadMessages(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const maxChars = Math.max(32000, Math.min(240000, Number(config.chatCompaction?.contextMaxChars || 32000) * 6));
  const maxMessages = 120;
  const perMessageMax = Math.max(8000, Math.min(24000, Number(config.chatCompaction?.messageMaxChars || 8000) * 3));
  const selected = [];
  let totalChars = 0;

  for (let index = source.length - 1; index >= 0; index -= 1) {
    const msg = source[index];
    if (msg?.role !== "user" && msg?.role !== "assistant") {
      continue;
    }
    const content = typeof msg?.content === "string" ? middleTruncate(msg.content, perMessageMax).trim() : "";
    if (!content) {
      continue;
    }
    const projected = totalChars + content.length;
    if (selected.length > 0 && (selected.length >= maxMessages || projected > maxChars)) {
      break;
    }
    selected.unshift({ role: msg.role, content });
    totalChars += content.length;
  }

  return selected;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleEl.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function initTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    applyTheme(storedTheme);
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function getFileLabSyntaxTheme() {
  const stored = String(localStorage.getItem(FILELAB_SYNTAX_THEME_KEY) || "").trim().toLowerCase();
  return SUPPORTED_CODE_THEMES.has(stored) ? stored : "verdant";
}

function applyCodeThemeFromFileLab() {
  document.documentElement.setAttribute("data-code-theme", getFileLabSyntaxTheme());
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeCodeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeCodeLanguage(value) {
  return String(value || "").trim().toLowerCase();
}

function codeTokenSuffix(index) {
  let value = Number(index) + 1;
  let suffix = "";
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(97 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return suffix || "a";
}

function codeTokenForIndex(index) {
  return `@@raa_ct_${codeTokenSuffix(index)}@@`;
}

function replaceTokenMatches(text, regex, className, placeholders) {
  return text.replace(regex, (match) => {
    const token = codeTokenForIndex(placeholders.length);
    placeholders.push(`<span class="tok-${className}">${match}</span>`);
    return token;
  });
}

function restoreTokenMatches(text, placeholders) {
  let output = text;
  for (let i = placeholders.length - 1; i >= 0; i -= 1) {
    output = output.replaceAll(codeTokenForIndex(i), placeholders[i]);
  }
  return output;
}

function highlightJsonCode(rawCode) {
  const placeholders = [];
  let text = escapeCodeHtml(rawCode);

  text = replaceTokenMatches(text, /"(?:\\.|[^"\\])*"(?=\s*:)/g, "key", placeholders);
  text = replaceTokenMatches(text, /"(?:\\.|[^"\\])*"/g, "string", placeholders);
  text = replaceTokenMatches(text, /\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, "number", placeholders);
  text = replaceTokenMatches(text, /\b(?:true|false|null)\b/g, "keyword", placeholders);

  return restoreTokenMatches(text, placeholders);
}

function highlightGenericCode(rawCode) {
  const placeholders = [];
  let text = escapeCodeHtml(rawCode);

  text = replaceTokenMatches(text, /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g, "string", placeholders);
  text = replaceTokenMatches(text, /\/\/[^\n]*/g, "comment", placeholders);
  text = text.replace(/(^|\s)(#[^\n]*)/gm, (_full, prefix, comment) => {
    const token = codeTokenForIndex(placeholders.length);
    placeholders.push(`<span class="tok-comment">${comment}</span>`);
    return `${prefix}${token}`;
  });

  const keywordPattern = new RegExp(`\\b(?:${GENERIC_CODE_KEYWORDS.join("|")})\\b`, "g");
  text = replaceTokenMatches(text, keywordPattern, "keyword", placeholders);
  text = replaceTokenMatches(text, /\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, "number", placeholders);
  text = replaceTokenMatches(text, /\b[A-Z][A-Za-z0-9_]*\b/g, "type", placeholders);
  text = replaceTokenMatches(text, /\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/g, "fn", placeholders);

  return restoreTokenMatches(text, placeholders);
}

function highlightCodeBlock(rawCode, language) {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === "json" || normalized === "jsonc") {
    return highlightJsonCode(rawCode);
  }
  return highlightGenericCode(rawCode);
}

function renderCodeFence(rawCode, language) {
  const normalizedLanguage = normalizeCodeLanguage(language);
  const safeLang = normalizedLanguage && /^[a-z0-9_+-]{1,24}$/.test(normalizedLanguage)
    ? normalizedLanguage
    : "";
  const code = String(rawCode || "").replace(/\r/g, "").replace(/\n$/, "");
  const highlighted = highlightCodeBlock(code, safeLang);
  const langBadge = safeLang ? `<span class="md-code-lang">${escapeHtml(safeLang)}</span>` : "";
  const langClass = safeLang ? ` language-${safeLang}` : "";
  return `<pre class="md-code-block">${langBadge}<code class="md-code${langClass}">${highlighted}</code></pre>`;
}

function renderMarkdown(markdown) {
  let source = String(markdown || "");
  const fences = [];

  const isTableDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || "");
  const splitTableCells = (line) => {
    const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((cell) => cell.trim());
  };
  const tableAlignFromDivider = (cell) => {
    const value = String(cell || "").trim();
    if (value.startsWith(":") && value.endsWith(":")) return "center";
    if (value.endsWith(":")) return "right";
    if (value.startsWith(":")) return "left";
    return "left";
  };

  source = source.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_match, language, code) => {
    const token = `@@FENCE_${fences.length}@@`;
    fences.push(renderCodeFence(code, language));
    return token;
  });

  let text = escapeHtml(source);

  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  text = text.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  text = text.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const lines = text.split("\n");
  let inUl = false;
  let inOl = false;
  const out = [];

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
      out.push('<table class="md-table">');
      out.push("<thead><tr>");
      headerCells.forEach((cell, index) => {
        out.push(`<th style="text-align:${alignments[index] || "left"}">${cell}</th>`);
      });
      out.push("</tr></thead>");
      out.push("<tbody>");

      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i];
        if (!rowLine.trim() || !rowLine.includes("|")) {
          break;
        }
        const rowCells = splitTableCells(rowLine);
        out.push("<tr>");
        rowCells.forEach((cell, index) => {
          out.push(`<td style="text-align:${alignments[index] || "left"}">${cell}</td>`);
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
      if (/^<h[1-3]>/.test(line) || /^@@FENCE_\d+@@$/.test(line.trim()) || /^<table/.test(line) || /^<hr\s*\/>$/.test(line.trim())) {
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

function markdownToPlainText(markdown) {
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(markdown || "");
  return (div.textContent || "").trim();
}

async function copyHtmlToClipboard(html, fallbackText) {
  if (window.ClipboardItem && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([fallbackText], { type: "text/plain" })
    });
    await navigator.clipboard.write([item]);
    return;
  }
  await navigator.clipboard.writeText(fallbackText);
}

function sanitizeFilenamePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "message";
}

function triggerDownload(content, mimeType, fileName) {
  const blob = new Blob([String(content || "")], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function getAssistantMessageDownloadPayload(message, downloadType) {
  const markdown = String(message?.content || "");
  const titlePart = sanitizeFilenamePart(shortTitleFromMessage(markdown) || "assistant-reply");
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const baseName = `assistant-${titlePart}-${stamp}`;

  if (downloadType === "markdown") {
    return {
      content: markdown,
      mimeType: "text/markdown;charset=utf-8",
      fileName: `${baseName}.md`,
      label: "markdown"
    };
  }

  if (downloadType === "text") {
    return {
      content: markdownToPlainText(markdown),
      mimeType: "text/plain;charset=utf-8",
      fileName: `${baseName}.txt`,
      label: "plain text"
    };
  }

  if (downloadType === "html") {
    const rendered = renderMarkdown(markdown);
    const htmlDoc = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Assistant Reply</title>
  </head>
  <body>
    <main>
${rendered}
    </main>
  </body>
</html>`;
    return {
      content: htmlDoc,
      mimeType: "text/html;charset=utf-8",
      fileName: `${baseName}.html`,
      label: "HTML"
    };
  }

  return null;
}

function normalizeContextEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const label = typeof entry.label === "string" ? entry.label.trim() : "";
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : uid(),
    label: label || "Untitled context",
    content: typeof entry.content === "string" ? entry.content : "",
    enabled: entry.enabled !== false,
    disabledLines: Array.from(new Set((Array.isArray(entry.disabledLines) ? entry.disabledLines : [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0)))
  };
}

function normalizeContextEntries(list) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => normalizeContextEntry(entry))
    .filter(Boolean)
    .slice(0, CONTEXT_MAX_ENTRIES);
}

function loadGlobalContextEntries() {
  try {
    return normalizeContextEntries(JSON.parse(storageGet(CONTEXT_GLOBAL_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveGlobalContextEntries(entries) {
  storageSet(CONTEXT_GLOBAL_KEY, JSON.stringify(normalizeContextEntries(entries)));
}

function getChatContextEntries(chat) {
  return normalizeContextEntries(chat?.contextEntries);
}

function getContextScope() {
  return contextScope === "global" ? "global" : "chat";
}

function getContextEntriesForScope(scope) {
  return scope === "global" ? loadGlobalContextEntries() : getChatContextEntries(getActiveChat());
}

function writeScopedContextEntries(scope, chat, entries) {
  if (scope === "global") {
    saveGlobalContextEntries(entries);
    return;
  }
  const target = chat || getActiveChat();
  target.contextEntries = normalizeContextEntries(entries);
  saveState();
}

function setContextEntriesForScope(scope, entries) {
  writeScopedContextEntries(scope, scope === "chat" ? getActiveChat() : null, entries);
}

function getActiveContextEntries(chat) {
  return [
    ...loadGlobalContextEntries().map((entry) => ({ ...entry, scope: "all chats" })),
    ...getChatContextEntries(chat).map((entry) => ({ ...entry, scope: "this chat" }))
  ]
    .map((entry) => {
      const disabledLines = new Set(entry.disabledLines);
      const content = entry.content.split("\n").filter((line, index) => !disabledLines.has(index)).join("\n");
      return { ...entry, content };
    })
    .filter((entry) => entry.enabled && entry.content.trim());
}

function buildContextPreamble(chat) {
  const entries = getActiveContextEntries(chat);
  if (entries.length === 0) {
    return "";
  }

  const body = entries
    .map((entry) => `- (${entry.scope}) ${entry.label}:\n${entry.content.trim()}`)
    .join("\n\n");

  return [
    "Persistent context maintained by the user for this conversation. Treat it as standing instructions and reference material.",
    middleTruncate(body, CONTEXT_PREAMBLE_MAX_CHARS),
    "When context tools are available, use list_context, add_context, update_context, or remove_context to manage this stored context. Otherwise, include a fenced block in your reply:",
    "```raa-context add\nscope: chat\nlabel: Short label\n<content to remember>\n```",
    "Use scope: global to store it for every chat, and ```raa-context remove``` with a matching label to delete an entry."
  ].join("\n\n");
}

function renderContextLineControls(item, entry) {
  let lineList = item.querySelector(".context-lines");
  if (!lineList) {
    lineList = document.createElement("div");
    lineList.className = "context-lines";
    item.appendChild(lineList);
  }
  lineList.replaceChildren();
  const lines = entry.content.split("\n");
  const disabledLines = new Set(entry.disabledLines);

  lines.forEach((line, index) => {
    const label = document.createElement("label");
    label.className = `context-line${disabledLines.has(index) ? " disabled" : ""}`;
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = !disabledLines.has(index);
    toggle.dataset.contextAction = "line-toggle";
    toggle.dataset.lineIndex = String(index);
    toggle.setAttribute("aria-label", `Include context line ${index + 1}`);
    const number = document.createElement("span");
    number.className = "context-line-number";
    number.textContent = String(index + 1);
    const text = document.createElement("span");
    text.className = "context-line-text";
    text.textContent = line || "(blank line)";
    label.append(toggle, number, text);
    lineList.appendChild(label);
  });
}

function renderContextPanel() {
  if (!contextListEl) {
    return;
  }

  const scope = getContextScope();
  if (contextManagerSummaryEl) {
    const chatCount = getChatContextEntries(getActiveChat()).length;
    const globalCount = loadGlobalContextEntries().length;
    contextManagerSummaryEl.textContent = `${chatCount} this chat · ${globalCount} all chats`;
  }
  if (contextScopeSelectEl) {
    contextScopeSelectEl.value = scope;
  }

  const entries = getContextEntriesForScope(scope);
  contextListEl.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "context-item";
    empty.textContent = scope === "global"
      ? "No shared context yet. Entries added here are sent with every chat in this browser."
      : "No context for this chat yet. Entries added here are sent with this chat only.";
    contextListEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = `context-item${entry.enabled ? "" : " disabled"}`;
    item.dataset.contextId = entry.id;

    const head = document.createElement("div");
    head.className = "context-item-head";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = entry.enabled;
    toggle.dataset.contextAction = "toggle";
    toggle.setAttribute("aria-label", `Include ${entry.label} in context`);

    const label = document.createElement("input");
    label.type = "text";
    label.value = entry.label;
    label.dataset.contextAction = "label";
    label.setAttribute("aria-label", "Context label");

    const scopeChip = document.createElement("span");
    scopeChip.className = "context-scope-chip";
    scopeChip.textContent = scope === "global" ? "all chats" : "this chat";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn-soft danger";
    remove.dataset.contextAction = "remove";
    remove.textContent = "Remove";

    head.append(toggle, label, scopeChip, remove);

    const content = document.createElement("textarea");
    content.value = entry.content;
    content.dataset.contextAction = "content";
    content.placeholder = "Build steps, server details, project conventions...";
    content.setAttribute("aria-label", `Context content for ${entry.label}`);

    item.append(head, content);
    renderContextLineControls(item, entry);
    contextListEl.appendChild(item);
  }
}

function setContextStatus(text) {
  if (contextStatusEl) {
    contextStatusEl.textContent = text;
  }
}

function updateContextEntryFromControl(control, field) {
  const item = control.closest("li[data-context-id]");
  if (!item) {
    return;
  }

  const scope = getContextScope();
  const entryId = item.dataset.contextId;
  const entries = getContextEntriesForScope(scope).map((entry) => {
    if (entry.id !== entryId) {
      return entry;
    }
    if (field === "label") {
      return { ...entry, label: String(control.value || "").trim() || "Untitled context" };
    }
    if (field === "content") {
      const content = String(control.value || "");
      const lineCount = content.split("\n").length;
      return { ...entry, content, disabledLines: entry.disabledLines.filter((index) => index < lineCount) };
    }
    if (field === "line-toggle") {
      const lineIndex = Number(control.dataset.lineIndex);
      const disabledLines = new Set(entry.disabledLines);
      if (control.checked) disabledLines.delete(lineIndex);
      else disabledLines.add(lineIndex);
      return { ...entry, disabledLines: Array.from(disabledLines).sort((left, right) => left - right) };
    }
    return { ...entry, enabled: Boolean(control.checked) };
  });

  setContextEntriesForScope(scope, entries);
  setContextStatus(`Saved to ${scope === "global" ? "all chats" : "this chat"} context.`);
  return entries.find((entry) => entry.id === entryId) || null;
}

function parseContextDirectiveBody(body) {
  const lines = String(body || "").replace(/\r/g, "").split("\n");
  const meta = {};
  let index = 0;

  while (index < lines.length) {
    const match = lines[index].match(/^\s*(scope|label|id)\s*:\s*(.*)$/i);
    if (!match) {
      break;
    }
    meta[match[1].toLowerCase()] = match[2].trim();
    index += 1;
  }

  return { meta, content: lines.slice(index).join("\n").trim() };
}

function applyAssistantContextDirectives(chatId, replyText) {
  const pattern = /```raa-context[ \t]+(add|update|remove)[ \t]*\r?\n([\s\S]*?)```/gi;
  let applied = 0;
  let match = pattern.exec(String(replyText || ""));

  while (match !== null) {
    const action = match[1].toLowerCase();
    const { meta, content } = parseContextDirectiveBody(match[2]);
    const scope = String(meta.scope || "chat").toLowerCase() === "global" ? "global" : "chat";
    const chat = scope === "chat" ? getChatById(chatId) : null;

    if (scope !== "chat" || chat) {
      const entries = scope === "global" ? loadGlobalContextEntries() : getChatContextEntries(chat);
      const label = String(meta.label || "").trim();
      const entryId = String(meta.id || "").trim();
      const isMatch = (entry) => (entryId && entry.id === entryId)
        || (label && entry.label.toLowerCase() === label.toLowerCase());

      if (action === "remove") {
        if (label || entryId) {
          const next = entries.filter((entry) => !isMatch(entry));
          if (next.length !== entries.length) {
            writeScopedContextEntries(scope, chat, next);
            applied += 1;
          }
        }
      } else if (content) {
        const existing = entries.find((entry) => isMatch(entry));
        const next = existing
          ? entries.map((entry) => (entry.id === existing.id
            ? { ...entry, label: label || entry.label, content }
            : entry))
          : [...entries, { id: uid(), label: label || "Agent context", content, enabled: true }];
        writeScopedContextEntries(scope, chat, next);
        applied += 1;
      }
    }

    match = pattern.exec(String(replyText || ""));
  }

  return applied;
}

function applyAgentContextMutations(chatId, mutations) {
  const chat = getChatById(chatId);
  if (!chat || !Array.isArray(mutations)) return 0;
  const entriesByScope = {
    chat: getChatContextEntries(chat),
    global: loadGlobalContextEntries()
  };
  const changedScopes = new Set();
  let applied = 0;

  for (const mutation of mutations.slice(0, CONTEXT_MAX_ENTRIES)) {
    const action = String(mutation?.action || "").toLowerCase();
    const scope = String(mutation?.scope || "chat").toLowerCase() === "global" ? "global" : "chat";
    const id = String(mutation?.id || "").trim();
    const label = String(mutation?.label || "").trim();
    const entries = entriesByScope[scope];
    const matchIndex = entries.findIndex((entry) => (id && entry.id === id)
      || (label && entry.label.toLowerCase() === label.toLowerCase()));

    if (action === "remove" && matchIndex >= 0) {
      entries.splice(matchIndex, 1);
    } else if (action === "update" && matchIndex >= 0) {
      const existing = entries[matchIndex];
      entries[matchIndex] = normalizeContextEntry({
        ...existing,
        label: typeof mutation.newLabel === "string" && mutation.newLabel.trim() ? mutation.newLabel : existing.label,
        content: typeof mutation.content === "string" ? mutation.content : existing.content,
        enabled: typeof mutation.enabled === "boolean" ? mutation.enabled : existing.enabled
      });
    } else if (action === "add" && String(mutation.content || "").trim()) {
      const entry = normalizeContextEntry({
        id: id || uid(),
        label: label || "Agent context",
        content: String(mutation.content || ""),
        enabled: mutation.enabled !== false
      });
      if (id && matchIndex >= 0) entries[matchIndex] = entry;
      else entries.push(entry);
    } else {
      continue;
    }
    changedScopes.add(scope);
    applied += 1;
  }

  for (const scope of changedScopes) {
    writeScopedContextEntries(scope, scope === "chat" ? chat : null, entriesByScope[scope]);
  }
  return applied;
}

function renderTabs() {
  const activeId = getActiveChat().id;
  tabListEl.innerHTML = "";

  for (const chat of state.chats) {
    const li = document.createElement("li");
    li.className = "tab-item";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tab-btn${chat.id === activeId ? " active" : ""}`;
    btn.dataset.chatId = chat.id;
    btn.innerHTML = `
      <span class="tab-title">${escapeHtml(chat.title || "New chat")}</span>
      <span class="tab-meta">${escapeHtml((chat.provider || config.defaultProvider) + ":" + (chat.model || config.defaultModel))}</span>
    `;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tab-delete";
    del.dataset.chatDelete = chat.id;
    del.textContent = "x";
    del.setAttribute("aria-label", "Delete chat");

    li.appendChild(btn);
    li.appendChild(del);
    tabListEl.appendChild(li);
  }
}

function renderMessages() {
  const chat = getActiveChat();
  messageListEl.innerHTML = "";

  if (chat.messages.length === 0) {
    const item = document.createElement("li");
    item.className = "msg assistant";
    item.innerHTML = `
      <div class="msg-head"><strong>Assistant</strong><span>Ready</span></div>
      <div class="md"><p>Start chatting. History is stored in your browser.</p></div>
    `;
    messageListEl.appendChild(item);
    return;
  }

  const latestUserMessageId = getLatestUserMessageId(chat);
  const retryVisibleForChat = failedRetryTarget.chatId === chat.id;

  for (const msg of chat.messages) {
    const item = document.createElement("li");
    item.className = `msg ${msg.role}`;
    const messageActions = msg.role === "assistant"
      ? `
        <button type="button" class="copy-md-btn" data-copy-type="markdown" data-msg-id="${escapeHtml(String(msg.id || ""))}">MD</button>
        <button type="button" class="copy-md-btn" data-copy-type="text" data-msg-id="${escapeHtml(String(msg.id || ""))}">Text</button>
        <button type="button" class="copy-md-btn" data-copy-type="html" data-msg-id="${escapeHtml(String(msg.id || ""))}">HTML</button>
        <button type="button" class="copy-md-btn" data-download-type="markdown" data-msg-id="${escapeHtml(String(msg.id || ""))}">DL MD</button>
        <button type="button" class="copy-md-btn" data-download-type="text" data-msg-id="${escapeHtml(String(msg.id || ""))}">DL TXT</button>
        <button type="button" class="copy-md-btn" data-download-type="html" data-msg-id="${escapeHtml(String(msg.id || ""))}">DL HTML</button>
      `
      : "";
    const retryButton = msg.role === "user"
      && retryVisibleForChat
      && String(msg.id || "") === String(latestUserMessageId || "")
      && String(msg.id || "") === String(failedRetryTarget.messageId || "")
      ? `<button type="button" class="copy-md-btn" data-retry-msg-id="${escapeHtml(String(msg.id || ""))}" data-retry-chat-id="${escapeHtml(String(chat.id || ""))}">Retry</button>`
      : "";
    item.innerHTML = `
      <div class="msg-head">
        <div class="msg-head-left">
          <strong>${msg.role === "user" ? "You" : "Assistant"}</strong>
          ${messageActions}
          ${retryButton}
        </div>
        <span>${formatTime(msg.createdAt)}</span>
      </div>
      <div class="md">${renderMarkdown(msg.content)}</div>
      ${Array.isArray(msg.executedTools) && msg.executedTools.length > 0
        ? `<div class="msg-tools">Tools used: ${msg.executedTools.map((tool) => `<span class="tool-chip">${escapeHtml(tool)}</span>`).join(" ")}</div>`
        : ""}
      ${msg.contextCompaction?.applied
        ? `<div class="msg-tools">Context compacted for provider: <span class="tool-chip">${escapeHtml(String(msg.contextCompaction.originalMessageCount || "?"))}</span> -> <span class="tool-chip">${escapeHtml(String(msg.contextCompaction.sentMessageCount || "?"))}</span> messages. Full chat remains in archive/history.</div>`
        : ""}
    `;
    messageListEl.appendChild(item);
  }

  chatPanelEl.scrollTop = chatPanelEl.scrollHeight;
}

function buildRequestBodyForUserMessage(chat, userMessageId) {
  const userIndex = chat.messages.findIndex((msg) => String(msg.id || "") === String(userMessageId || "") && msg.role === "user");
  if (userIndex < 0) {
    throw new Error("Original user message was not found.");
  }

  const contextMessages = chat.messages.slice(0, userIndex + 1);
  const payloadMessages = buildPayloadMessages(contextMessages);
  const contextPreamble = buildContextPreamble(chat);
  return {
    provider: chat.provider,
    model: chat.model,
    reasoningEffort: getReasoningEffortOptions(chat.provider, chat.model).includes(chat.reasoningEffort)
      ? chat.reasoningEffort
      : undefined,
    agentMode: agentModeToggleEl.checked,
    agentMaxStepsOverride: Number.isInteger(Number(chat.agentMaxStepsOverride)) && Number(chat.agentMaxStepsOverride) > 0
      ? Number(chat.agentMaxStepsOverride)
      : undefined,
    agentMaxStepsOverrideCode: chat.agentMaxStepsOverrideCode || undefined,
    autoCompact: config.chatCompaction?.enabled !== false,
    persistentContext: contextPreamble || undefined,
    contextEntries: {
      chat: getChatContextEntries(chat),
      global: loadGlobalContextEntries()
    },
    messages: payloadMessages
  };
}

function applyChatResponseStatus(data) {
  const usedTools = Array.isArray(data.executedTools) ? data.executedTools : [];
  const contextNote = lastContextDirectiveCount > 0
    ? ` Context updated (${lastContextDirectiveCount} change(s)).`
    : "";
  if (data.contextCompaction?.applied) {
    statusEl.textContent = `Done. Provider context was compacted (${data.contextCompaction.originalMessageCount || "?"} -> ${data.contextCompaction.sentMessageCount || "?"} messages); full chat remains archived.${contextNote}`;
  } else if (agentModeToggleEl.checked && usedTools.length === 0) {
    statusEl.textContent = `Done, but no tools were executed for this reply.${contextNote}`;
  } else {
    statusEl.textContent = `Done.${contextNote}`;
  }
}

async function submitUserMessageRequest(chatId, userMessageId) {
  const requestChat = getChatById(chatId);
  if (!requestChat) {
    throw new Error("Chat no longer exists.");
  }

  const requestBody = buildRequestBodyForUserMessage(requestChat, userMessageId);
  const { response, data } = agentModeToggleEl.checked
    ? await sendPromptViaJob(requestBody)
    : await postChatWithRetry(requestBody);

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  const writeChat = getChatById(chatId);
  if (!writeChat) {
    throw new Error("Chat no longer exists.");
  }
  const stillExists = writeChat.messages.some((msg) => String(msg.id || "") === String(userMessageId || "") && msg.role === "user");
  if (!stillExists) {
    throw new Error("Original user message is missing.");
  }

  writeChat.messages.push({
    id: uid(),
    role: "assistant",
    content: data.reply || "(No output returned)",
    createdAt: new Date().toISOString(),
    traceId: String(data.traceId || ""),
    executedTools: Array.isArray(data.executedTools) ? data.executedTools : [],
    contextCompaction: data.contextCompaction || null
  });
  updateTracePanel(data.traceId || "", "done");

  if (data.model) {
    writeChat.model = data.model;
  }

  lastContextDirectiveCount = applyAgentContextMutations(chatId, data.contextMutations)
    + applyAssistantContextDirectives(chatId, data.reply || "");
  saveState();
  renderAll();
  loadToolRuns();
  clearFailedRetryTarget();
  return data;
}

async function retryFailedUserMessage(chatId, userMessageId) {
  const chat = getChatById(chatId);
  if (!chat) {
    statusEl.textContent = "Chat no longer exists.";
    return;
  }
  const latestUserId = getLatestUserMessageId(chat);
  if (String(userMessageId || "") !== String(latestUserId || "")) {
    statusEl.textContent = "Retry is only available for the latest user message.";
    return;
  }

  sendBtnEl.disabled = true;
  clearFailedRetryTarget();
  renderAll();
  statusEl.textContent = `Retrying with ${chat.provider}:${chat.model}...`;

  try {
    const data = await submitUserMessageRequest(chat.id, userMessageId);
    applyChatResponseStatus(data);
  } catch (error) {
    setFailedRetryTarget(chat.id, userMessageId);
    renderAll();
    updateTracePanel(currentTraceId, "error");
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    sendBtnEl.disabled = false;
  }
}

function updateModelSelect() {
  const chat = getActiveChat();
  const provider = normalizeProvider(chat.provider) || config.defaultProvider;

  const providerModels = modelCatalog
    .filter((entry) => entry.provider === provider && CHAT_CAPABLE_TYPES.has(entry.type))
    .map((entry) => entry.tag);

  let opts = providerModels.length > 0
    ? [...new Set(providerModels)]
    : [...new Set([
      provider === "xai" ? config.xaiDefaultModel : config.defaultModel,
      ...FALLBACK_MODELS
    ])];

  const providerAllowedModels = provider === "xai"
    ? config.xaiAllowedModels
    : config.allowedModels;

  if (providerAllowedModels.length > 0) {
    opts = opts.filter((item) => providerAllowedModels.includes(item));
    if (opts.length === 0) {
      opts = [...providerAllowedModels];
    }
  }

  modelSelectEl.innerHTML = "";

  for (const model of opts) {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model;
    modelSelectEl.appendChild(opt);
  }

  if (!opts.includes(chat.model)) {
    chat.model = opts[0];
    saveState();
  }
  modelSelectEl.value = chat.model;
}

function updateProviderSelect() {
  const configuredProviders = config.supportedProviders
    .map((item) => normalizeProvider(item))
    .filter(Boolean);
  const configuredProviderSet = new Set(configuredProviders);
  const providerSet = new Set(configuredProviders.length > 0 ? configuredProviders : ["openai"]);

  for (const entry of modelCatalog) {
    if (configuredProviderSet.size === 0 || configuredProviderSet.has(entry.provider)) {
      providerSet.add(entry.provider);
    }
  }

  const providers = [...providerSet];
  providerSelectEl.innerHTML = "";

  for (const provider of providers) {
    const opt = document.createElement("option");
    opt.value = provider;
    opt.textContent = provider;
    providerSelectEl.appendChild(opt);
  }

  const chat = getActiveChat();
  if (!providers.includes(chat.provider)) {
    chat.provider = providers[0] || config.defaultProvider;
    saveState();
  }
  providerSelectEl.value = chat.provider;
}

function renderAll() {
  ensureStateIntegrity();
  renderTabs();
  updateProviderSelect();
  updateModelSelect();
  syncReasoningEffortControl();
  syncAgentModeToggle();
  renderContextPanel();
  renderMessages();
}

function countStoredLegacyCodeTokens() {
  let total = 0;
  for (const chat of state.chats || []) {
    for (const msg of chat.messages || []) {
      const matches = String(msg?.content || "").match(/@@CODETOKEN_\d+@@/g);
      total += matches ? matches.length : 0;
    }
  }
  return total;
}

function getReasoningEffortOptions(provider, model) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = String(model || "").trim();
  if (!normalizedProvider || !normalizedModel) {
    return [];
  }

  const fromCatalog = modelCatalog.find((entry) => entry.provider === normalizedProvider && entry.tag === normalizedModel);
  if (fromCatalog && Array.isArray(fromCatalog.reasoningEfforts) && fromCatalog.reasoningEfforts.length > 0) {
    return fromCatalog.reasoningEfforts;
  }
  return [];
}

function syncReasoningEffortControl() {
  if (!reasoningEffortFieldEl || !reasoningEffortSelectEl) {
    return;
  }

  const chat = getActiveChat();
  const options = getReasoningEffortOptions(chat.provider, chat.model);

  if (options.length === 0) {
    reasoningEffortFieldEl.hidden = true;
    reasoningEffortSelectEl.innerHTML = "";
    reasoningEffortSelectEl.disabled = true;
    if (chat.reasoningEffort) {
      chat.reasoningEffort = "";
      saveState();
    }
    return;
  }

  reasoningEffortFieldEl.hidden = false;
  reasoningEffortSelectEl.disabled = false;
  reasoningEffortSelectEl.innerHTML = "";

  const autoOption = document.createElement("option");
  autoOption.value = "";
  autoOption.textContent = "Default";
  reasoningEffortSelectEl.appendChild(autoOption);

  for (const effort of options) {
    const opt = document.createElement("option");
    opt.value = effort;
    opt.textContent = effort;
    reasoningEffortSelectEl.appendChild(opt);
  }

  if (!options.includes(chat.reasoningEffort)) {
    chat.reasoningEffort = "";
    saveState();
  }
  reasoningEffortSelectEl.value = chat.reasoningEffort || "";
}

function timeAgo(value) {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function getToolRunsFilter() {
  const raw = localStorage.getItem(TOOL_RUNS_FILTER_STORAGE_KEY);
  if (raw === "agent" || raw === "file" || raw === "all") {
    return raw;
  }
  return "all";
}

function notificationsEnabled() {
  return localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === "true";
}

function notificationSoundEnabled() {
  return localStorage.getItem(NOTIFICATIONS_SOUND_ENABLED_KEY) === "true";
}

function getNotificationLevelsConfig() {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_LEVELS_KEY);
    if (!raw) {
      return { info: true, success: true, warning: true, error: true };
    }
    const parsed = JSON.parse(raw);
    return {
      info: parsed?.info !== false,
      success: parsed?.success !== false,
      warning: parsed?.warning !== false,
      error: parsed?.error !== false
    };
  } catch {
    return { info: true, success: true, warning: true, error: true };
  }
}

function setNotificationLevelsConfig(configValue) {
  localStorage.setItem(NOTIFICATIONS_LEVELS_KEY, JSON.stringify({
    info: Boolean(configValue?.info),
    success: Boolean(configValue?.success),
    warning: Boolean(configValue?.warning),
    error: Boolean(configValue?.error)
  }));
}

function getNotificationDebounceMs() {
  const value = Number(localStorage.getItem(NOTIFICATIONS_DEBOUNCE_MS_KEY) || 1200);
  if (!Number.isFinite(value)) {
    return 1200;
  }
  return Math.max(500, Math.min(30000, value));
}

function setNotificationDebounceMs(value) {
  const next = Math.max(500, Math.min(30000, Number(value || 1200)));
  localStorage.setItem(NOTIFICATIONS_DEBOUNCE_MS_KEY, String(next));
  return next;
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeNotificationRule(rule) {
  const cooldownMsRaw = Number(rule?.cooldownMs);
  const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(0, Math.min(600000, cooldownMsRaw)) : 5000;
  const webhookUrl = String(rule?.webhookUrl || "").trim().slice(0, 400);
  return {
    id: String(rule?.id || ""),
    name: String(rule?.name || "").trim().slice(0, 80),
    enabled: rule?.enabled !== false,
    messageIncludes: String(rule?.messageIncludes || "").trim().slice(0, 120),
    cooldownMs,
    severities: {
      info: rule?.severities?.info !== false,
      success: rule?.severities?.success !== false,
      warning: rule?.severities?.warning !== false,
      error: rule?.severities?.error !== false
    },
    actions: {
      toast: rule?.actions?.toast !== false,
      desktop: rule?.actions?.desktop !== false,
      sound: Boolean(rule?.actions?.sound),
      titleFlash: Boolean(rule?.actions?.titleFlash),
      webhook: Boolean(rule?.actions?.webhook)
    },
    webhookUrl: isHttpUrl(webhookUrl) ? webhookUrl : ""
  };
}

function getNotificationRules() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_RULES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((rule) => sanitizeNotificationRule(rule)).filter((rule) => rule.id);
  } catch {
    return [];
  }
}

function normalizeSeverity(value) {
  const level = String(value || "info").trim().toLowerCase();
  if (level === "success" || level === "warning" || level === "error" || level === "info") {
    return level;
  }
  return "info";
}

function ensureNotificationToastContainer() {
  if (notificationToastContainer) {
    return notificationToastContainer;
  }
  const el = document.createElement("div");
  el.className = "notify-toast-container";
  document.body.appendChild(el);
  notificationToastContainer = el;
  return notificationToastContainer;
}

function showNotificationToast(level, message) {
  const container = ensureNotificationToastContainer();
  const item = document.createElement("div");
  item.className = `notify-toast ${level}`;
  item.innerHTML = `<strong>${level.toUpperCase()}</strong><span>${escapeHtml(String(message || ""))}</span>`;
  container.prepend(item);

  const timeoutMs = level === "success" ? 2200 : level === "info" ? 3000 : 5000;
  setTimeout(() => {
    item.remove();
  }, timeoutMs);
}

function maybePlayNotificationSound(level) {
  if (!notificationSoundEnabled()) {
    return;
  }
  if (level === "info") {
    return;
  }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = level === "error" ? 420 : level === "warning" ? 560 : 680;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 300);
  } catch {
    // Ignore audio failures.
  }
}

function startTitleFlash(level) {
  if (level !== "warning" && level !== "error") {
    return;
  }
  const baseTitle = document.title;
  const blinkTitle = level === "error" ? "[ERROR] Remote AI Access" : "[WARNING] Remote AI Access";
  const durationMs = level === "error" ? 10000 : 6000;
  notificationTitleFlashEndsAt = Date.now() + durationMs;

  if (notificationTitleFlashTimer) {
    return;
  }

  let flip = false;
  notificationTitleFlashTimer = setInterval(() => {
    if (Date.now() >= notificationTitleFlashEndsAt || !document.hidden) {
      clearInterval(notificationTitleFlashTimer);
      notificationTitleFlashTimer = null;
      document.title = baseTitle;
      return;
    }
    flip = !flip;
    document.title = flip ? blinkTitle : baseTitle;
  }, 800);
}

async function maybeShowDesktopNotification(level, message) {
  if (!("Notification" in window)) {
    return false;
  }
  if (!notificationsEnabled()) {
    return false;
  }

  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return false;
    }
  }

  if (Notification.permission !== "granted") {
    return false;
  }

  const note = new Notification(`Remote AI Access - ${level.toUpperCase()}`, {
    body: String(message || ""),
    tag: `remote-ai-${level}-${Date.now()}`,
    renotify: true,
    requireInteraction: level === "error",
    silent: !notificationSoundEnabled()
  });

  note.onclick = () => {
    try {
      window.focus();
    } catch {
      // Ignore focus errors.
    }
    note.close();
  };

  return true;
}

async function postNotificationWebhook(rule, payload) {
  const url = String(rule?.webhookUrl || "").trim();
  if (!isHttpUrl(url)) {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyNotificationRules(item, level, message) {
  const allRules = getNotificationRules();
  const enabledRules = allRules.filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    return false;
  }

  let ranAction = false;
  const now = Date.now();

  for (const rule of enabledRules) {
    if (!rule.severities[level]) {
      continue;
    }

    const needle = String(rule.messageIncludes || "").toLowerCase();
    if (needle && !String(message || "").toLowerCase().includes(needle)) {
      continue;
    }

    const lastRun = notificationRuleLastRunAt.get(rule.id) || 0;
    if (rule.cooldownMs > 0 && now - lastRun < rule.cooldownMs) {
      continue;
    }
    notificationRuleLastRunAt.set(rule.id, now);

    if (rule.actions.toast) {
      showNotificationToast(level, message);
      ranAction = true;
    }

    if (rule.actions.sound) {
      maybePlayNotificationSound(level);
      ranAction = true;
    }

    if (rule.actions.titleFlash) {
      startTitleFlash(level);
      ranAction = true;
    }

    if (rule.actions.desktop) {
      const sent = await maybeShowDesktopNotification(level, message);
      ranAction = ranAction || sent;
    }

    if (rule.actions.webhook && rule.webhookUrl) {
      const payload = {
        source: "remote-ai-access",
        eventType: "notification-rule-match",
        timestamp: new Date().toISOString(),
        rule: {
          id: rule.id,
          name: rule.name
        },
        notification: {
          id: item?.id || null,
          level,
          message,
          createdAt: item?.timestamp || null
        }
      };
      const posted = await postNotificationWebhook(rule, payload);
      ranAction = ranAction || posted;
    }
  }

  return ranAction;
}

function shouldShowNotification(id, level, message) {
  const now = Date.now();
  const dedupeKey = `${id || "none"}:${level}:${String(message || "").slice(0, 140)}`;
  const levels = getNotificationLevelsConfig();

  if (levels[level] === false) {
    return false;
  }

  const debounceMs = getNotificationDebounceMs();

  // Global notification rate limit to avoid UI spam.
  if (now - lastNotificationShownAt < debounceMs) {
    return false;
  }

  // Dedupe repeated notifications within 20s.
  const seenAt = recentlyShownNotificationKeys.get(dedupeKey);
  if (seenAt && now - seenAt < 20000) {
    return false;
  }

  recentlyShownNotificationKeys.set(dedupeKey, now);
  if (recentlyShownNotificationKeys.size > 120) {
    for (const [key, ts] of recentlyShownNotificationKeys) {
      if (now - ts > 60000) {
        recentlyShownNotificationKeys.delete(key);
      }
    }
  }

  lastNotificationShownAt = now;
  return true;
}

async function deliverNotificationEvent(item) {
  const level = normalizeSeverity(item?.level);
  const message = String(item?.message || "");

  if (!message || !shouldShowNotification(item?.id, level, message)) {
    return;
  }

  const handledByRules = await applyNotificationRules(item, level, message);
  if (handledByRules) {
    statusEl.textContent = `Notification rule matched: ${message}`;
    return;
  }

  showNotificationToast(level, message);
  maybePlayNotificationSound(level);

  const isBackground = document.hidden || !document.hasFocus();
  if (isBackground) {
    const usedDesktopNotification = await maybeShowDesktopNotification(level, message);

    if (!usedDesktopNotification && level === "error") {
      window.alert(`Notification (${level}): ${message}`);
    }
    startTitleFlash(level);
  } else {
    statusEl.textContent = `Notification: ${message}`;
  }
}

async function loadToolRuns() {
  if (!toolRunsListEl) {
    return;
  }

  try {
    const response = await fetch("/api/files/audit?limit=80");
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Failed to load tool runs");
    }

    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const filter = getToolRunsFilter();
    const latestByTool = new Map();
    for (const entry of entries) {
      const operation = String(entry?.operation || "").trim();
      const isAgentTool = operation === "agent-tool-record" || operation === "agent-tool" || operation === "agent-tool-error";

      if (filter === "agent" && !isAgentTool) {
        continue;
      }

      if (filter === "file" && isAgentTool) {
        continue;
      }

      const label = isAgentTool
        ? String(entry?.details?.name || "").trim()
        : operation;

      if (!label || latestByTool.has(label)) {
        continue;
      }
      latestByTool.set(label, entry);
    }

    toolRunsListEl.innerHTML = "";
    if (latestByTool.size === 0) {
      const li = document.createElement("li");
      li.className = "tool-run-item";
      li.textContent = "No tool runs yet.";
      toolRunsListEl.appendChild(li);
      return;
    }

    for (const [toolName, entry] of latestByTool) {
      const li = document.createElement("li");
      li.className = "tool-run-item";
      li.innerHTML = `<span class="tool-chip">${escapeHtml(toolName)}</span> <span class="tool-run-time">${escapeHtml(timeAgo(entry.timestamp))}</span>`;
      toolRunsListEl.appendChild(li);
    }
  } catch {
    toolRunsListEl.innerHTML = "";
    const li = document.createElement("li");
    li.className = "tool-run-item";
    li.textContent = "Failed to load tool runs.";
    toolRunsListEl.appendChild(li);
  }
}

async function checkNotifications() {
  try {
    const response = await fetch("/api/notifications?limit=20", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await parseJsonResponse(response);
    const rows = Array.isArray(data?.notifications) ? data.notifications : [];
    if (rows.length === 0) {
      return;
    }

    const latest = rows[0];
    if (!latest?.id) {
      return;
    }

    const lastSeenId = localStorage.getItem(LAST_SEEN_NOTIFICATION_ID_KEY);
    if (!lastSeenId) {
      localStorage.setItem(LAST_SEEN_NOTIFICATION_ID_KEY, latest.id);
      return;
    }

    if (latest.id === lastSeenId) {
      return;
    }

    const unseen = [];
    for (const row of rows) {
      if (row?.id === lastSeenId) {
        break;
      }
      unseen.push(row);
    }

    localStorage.setItem(LAST_SEEN_NOTIFICATION_ID_KEY, latest.id);
    for (const row of unseen.reverse()) {
      await deliverNotificationEvent(row);
    }
  } catch {
    // Ignore notification poll errors to avoid interrupting chat flow.
  }
}

function startNotificationPolling() {
  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
  }
  checkNotifications();
  notificationPollTimer = setInterval(checkNotifications, 15000);
}

function isAgentModeEnabled() {
  return localStorage.getItem(AGENT_MODE_STORAGE_KEY) === "true";
}

function syncAgentModeToggle() {
  const chat = getActiveChat();
  const provider = normalizeProvider(chat.provider);
  const supported = (config.agentModeSupportedProviders || []).includes(provider);
  agentModeToggleEl.disabled = !supported;
  if (!supported) {
    agentModeToggleEl.checked = false;
    return;
  }
  agentModeToggleEl.checked = isAgentModeEnabled();

  if (agentStepOverrideInputEl && agentStepOverrideCodeInputEl) {
    const max = Number(config?.agentStepOverride?.maxOverrideSteps || 40);
    const base = Number(config?.agentStepOverride?.baseMaxSteps || 16);
    const overrideEnabled = Boolean(config?.agentStepOverride?.enabled);
    const enabledForChat = supported && agentModeToggleEl.checked;
    agentStepOverrideInputEl.disabled = !enabledForChat;
    agentStepOverrideCodeInputEl.disabled = !enabledForChat;
    agentStepOverrideInputEl.max = String(max);
    agentStepOverrideInputEl.placeholder = `${base}`;
    agentStepOverrideInputEl.title = overrideEnabled
      ? `Optional per-chat step override (${base}-${max})`
      : `Step override disabled on server (base ${base})`;
    if (!enabledForChat) {
      agentStepOverrideInputEl.value = "";
      agentStepOverrideCodeInputEl.value = "";
      return;
    }
    const requested = Number(chat?.agentMaxStepsOverride || 0);
    agentStepOverrideInputEl.value = requested > 0 ? String(requested) : "";
    agentStepOverrideCodeInputEl.value = String(chat?.agentMaxStepsOverrideCode || "");
  }
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      return;
    }
    const data = await parseJsonResponse(response);
    if (typeof data?.defaultProvider === "string") {
      config.defaultProvider = normalizeProvider(data.defaultProvider) || config.defaultProvider;
    }
    if (typeof data?.defaultModel === "string") {
      config.defaultModel = data.defaultModel;
    }
    if (typeof data?.xaiDefaultModel === "string") {
      config.xaiDefaultModel = data.xaiDefaultModel;
    }
    if (Array.isArray(data?.allowedModels)) {
      config.allowedModels = data.allowedModels.filter((item) => typeof item === "string" && item);
    }
    if (Array.isArray(data?.xaiAllowedModels)) {
      config.xaiAllowedModels = data.xaiAllowedModels.filter((item) => typeof item === "string" && item);
    }
    if (Array.isArray(data?.supportedProviders)) {
      config.supportedProviders = data.supportedProviders
        .map((item) => normalizeProvider(item))
        .filter(Boolean);
    }
    if (Array.isArray(data?.agentModeSupportedProviders)) {
      config.agentModeSupportedProviders = data.agentModeSupportedProviders
        .map((item) => normalizeProvider(item))
        .filter(Boolean);
    }
    if (data?.agentStepOverride && typeof data.agentStepOverride === "object") {
      config.agentStepOverride = {
        enabled: Boolean(data.agentStepOverride.enabled),
        baseMaxSteps: Number(data.agentStepOverride.baseMaxSteps || config.agentStepOverride.baseMaxSteps || 16),
        maxOverrideSteps: Number(data.agentStepOverride.maxOverrideSteps || config.agentStepOverride.maxOverrideSteps || 40)
      };
    }
    if (data?.chatCompaction && typeof data.chatCompaction === "object") {
      config.chatCompaction = {
        enabled: data.chatCompaction.enabled !== false,
        messageMaxChars: Number(data.chatCompaction.messageMaxChars || config.chatCompaction.messageMaxChars || 8000),
        contextMaxChars: Number(data.chatCompaction.contextMaxChars || config.chatCompaction.contextMaxChars || 32000)
      };
    }
  } catch {
    // Keep defaults if config endpoint is unavailable.
  }

  for (const chat of state.chats) {
    if (!chat.provider) {
      chat.provider = config.defaultProvider;
    }
    if (!chat.model) {
      chat.model = config.defaultModel;
    }
  }
  saveState();
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((item) => item.trim());
}

async function parseJsonResponse(response) {
  const bodyText = await response.text();
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    const compact = bodyText.replace(/\s+/g, " ").trim();
    const snippet = compact.slice(0, 180);
    if (response.status === 499 || /cancelled|canceled/i.test(snippet)) {
      throw new Error("Request was cancelled.");
    }
    if (response.status === 524 || /cloudflare|timeout|gateway/i.test(snippet)) {
      throw new Error("Request timed out at the edge. Try agent mode, which now uses async job polling for long tasks.");
    }
    throw new Error(`Server returned non-JSON response (${response.status}): ${snippet || "empty body"}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopActiveJobTracking() {
  if (!activeChatJob) {
    if (cancelJobBtnEl) {
      cancelJobBtnEl.hidden = true;
      cancelJobBtnEl.disabled = true;
    }
    return;
  }

  if (activeChatJob.eventSource) {
    try {
      activeChatJob.eventSource.close();
    } catch {
      // Ignore close errors.
    }
  }
  activeChatJob = null;
  if (cancelJobBtnEl) {
    cancelJobBtnEl.hidden = true;
    cancelJobBtnEl.disabled = true;
  }
}

function startChatJobEventStream(jobId) {
  if (typeof EventSource === "undefined") {
    return;
  }
  if (!activeChatJob || activeChatJob.id !== jobId) {
    return;
  }

  const source = new EventSource(`/api/chat/jobs/${encodeURIComponent(jobId)}/events`);
  activeChatJob.eventSource = source;

  source.addEventListener("tool-start", (event) => {
    try {
      const parsed = JSON.parse(event.data || "{}");
      const name = parsed?.payload?.name || "tool";
      statusEl.textContent = `Running tool: ${name}`;
    } catch {
      // Ignore malformed event payloads.
    }
  });

  source.addEventListener("tool-end", (event) => {
    try {
      const parsed = JSON.parse(event.data || "{}");
      const name = parsed?.payload?.name || "tool";
      const durationMs = Number(parsed?.payload?.durationMs || 0);
      statusEl.textContent = `Finished tool: ${name} (${durationMs}ms)`;
    } catch {
      // Ignore malformed event payloads.
    }
  });

  source.addEventListener("failed", () => {
    updateTracePanel(currentTraceId, "failed");
    stopActiveJobTracking();
  });
  source.addEventListener("completed", () => {
    updateTracePanel(currentTraceId, "completed");
    stopActiveJobTracking();
  });
  source.addEventListener("cancelled", () => {
    updateTracePanel(currentTraceId, "cancelled");
    stopActiveJobTracking();
  });

  source.onerror = () => {
    // Keep normal polling as the source of truth if stream drops.
    if (activeChatJob && activeChatJob.id === jobId && activeChatJob.eventSource === source) {
      try {
        source.close();
      } catch {
        // Ignore close errors.
      }
      activeChatJob.eventSource = null;
    }
  };
}

async function startChatJob(body) {
  const response = await fetch("/api/chat/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await parseJsonResponse(response);
  return { response, data };
}

async function pollChatJob(jobId, timeoutMs = 18 * 60 * 1000) {
  const started = Date.now();
  let delayMs = 900;

  while (Date.now() - started < timeoutMs) {
    if (activeChatJob && activeChatJob.id === jobId && activeChatJob.cancelRequested) {
      throw new Error("Chat job cancelled.");
    }

    const response = await fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || `Failed to poll chat job (${response.status})`);
    }

    const job = data?.job || {};
    if (job.status === "completed") {
      return job.result || {};
    }
    if (job.status === "failed") {
      throw new Error(job?.error?.message || "Chat job failed");
    }
    if (job.status === "cancelled") {
      throw new Error(job?.error?.message || "Chat job cancelled");
    }

    statusEl.textContent = `Working (${job.status || "running"})${job.traceId ? ` [${job.traceId}]` : ""}...`;
    await delay(delayMs);
    delayMs = Math.min(2200, delayMs + 180);
  }

  throw new Error("Chat job is still running. Please retry in a moment.");
}

async function postChatWithRetry(body, retries = 1) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if ([502, 503, 504].includes(response.status) && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return postChatWithRetry(body, retries - 1);
  }

  const data = await parseJsonResponse(response);
  return { response, data };
}

async function sendPromptViaJob(body) {
  stopActiveJobTracking();
  const started = await startChatJob(body);
  if (!started.response.ok) {
    throw new Error(started.data?.error || "Failed to start chat job");
  }
  const job = started.data?.job || {};
  const jobId = job.id;
  if (!jobId) {
    throw new Error("Server returned an invalid chat job id");
  }
  activeChatJob = { id: jobId, eventSource: null, cancelRequested: false };
  updateTracePanel(job.traceId, "running");
  if (cancelJobBtnEl) {
    cancelJobBtnEl.hidden = false;
    cancelJobBtnEl.disabled = false;
  }
  startChatJobEventStream(jobId);
  statusEl.textContent = `Long task started${job.traceId ? ` [${job.traceId}]` : ""}. Polling for completion...`;
  try {
    const result = await pollChatJob(jobId);
    updateTracePanel(result?.traceId || job.traceId || "", "completed");
    maybeAutoOpenFilteredAudit(result?.traceId || job.traceId || "");
    return { response: { ok: true, status: 200 }, data: result };
  } finally {
    stopActiveJobTracking();
  }
}

async function cancelActiveChatJob() {
  if (!activeChatJob?.id) {
    return;
  }
  const jobId = activeChatJob.id;
  activeChatJob.cancelRequested = true;
  if (cancelJobBtnEl) {
    cancelJobBtnEl.disabled = true;
  }
  try {
    const response = await fetch(`/api/chat/jobs/${encodeURIComponent(jobId)}`, {
      method: "DELETE"
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Failed to cancel job");
    }
    statusEl.textContent = "Job cancelled.";
  } catch (error) {
    statusEl.textContent = `Cancel failed: ${error.message}`;
  }
}

async function loadModelCatalog() {
  try {
    const response = await fetch("/models.csv", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const csv = await response.text();
    const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) {
      return;
    }

    const header = parseCsvLine(lines[0]);
    const providerIndex = header.indexOf("Provider");
    const agencyIndex = header.indexOf("Agency");
    const modelNameIndex = header.indexOf("Name");
    const tagIndex = header.indexOf("Model Tag");
    const typeIndex = header.indexOf("Type");
    const reasoningEffortsIndex = header.indexOf("Reasoning Efforts");

    if (tagIndex < 0 || typeIndex < 0) {
      return;
    }

    modelCatalog = lines
      .slice(1)
      .map((line) => parseCsvLine(line))
      .map((parts) => ({
        provider: normalizeProvider(
          providerIndex >= 0
            ? parts[providerIndex]
            : (agencyIndex >= 0 ? parts[agencyIndex] : "openai")
        ) || "openai",
        name: modelNameIndex >= 0 ? parts[modelNameIndex] : "",
        tag: parts[tagIndex],
        type: normalizeProvider(parts[typeIndex]),
        reasoningEfforts: reasoningEffortsIndex >= 0
          ? String(parts[reasoningEffortsIndex] || "")
            .split(/[|,]/)
            .map((item) => normalizeReasoningEffort(item))
            .filter(Boolean)
          : []
      }))
      .filter((entry) => /^[a-zA-Z0-9._/-]{2,120}$/.test(entry.tag));
  } catch {
    modelCatalog = [];
  }    
}

async function sendPrompt() {
  const chat = getActiveChat();
  const chatId = chat.id;
  const text = promptEl.value.trim();
  if (!text) {
    statusEl.textContent = "Please enter a message.";
    return;
  }

  const userMessage = {
    id: uid(),
    role: "user",
    content: text,
    createdAt: new Date().toISOString()
  };

  chat.messages.push(userMessage);
  if (chat.title === "New chat") {
    chat.title = shortTitleFromMessage(text) || "New chat";
  }
  saveState();
  renderAll();
  promptEl.value = "";
  clearFailedRetryTarget();

  sendBtnEl.disabled = true;
  const activeChat = getChatById(chatId) || getActiveChat();
  statusEl.textContent = `Thinking with ${activeChat.provider}:${activeChat.model}...`;

  try {
    const data = await submitUserMessageRequest(chatId, userMessage.id);
    applyChatResponseStatus(data);
  } catch (error) {
    setFailedRetryTarget(chatId, userMessage.id);
    renderAll();
    updateTracePanel(currentTraceId, "error");
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    sendBtnEl.disabled = false;
  }
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

newChatBtnEl.addEventListener("click", () => {
  const chat = createChat({
    provider: normalizeProvider(providerSelectEl.value) || config.defaultProvider,
    model: modelSelectEl.value || config.defaultModel
  });
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  saveState();
  renderAll();
  promptEl.focus();
});

tabListEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const deleteId = target.dataset.chatDelete;
  if (deleteId) {
    state.chats = state.chats.filter((chat) => chat.id !== deleteId);
    if (state.chats.length === 0) {
      const chat = createChat();
      state.chats = [chat];
      state.activeChatId = chat.id;
    } else if (state.activeChatId === deleteId) {
      state.activeChatId = state.chats[0].id;
    }
    saveState();
    renderAll();
    return;
  }

  const tabBtn = target.closest("button[data-chat-id]");
  if (tabBtn instanceof HTMLElement) {
    state.activeChatId = tabBtn.dataset.chatId;
    saveState();
    renderAll();
  }
});

messageListEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const retryBtn = target.closest("button[data-retry-msg-id][data-retry-chat-id]");
  if (retryBtn instanceof HTMLButtonElement) {
    await retryFailedUserMessage(
      String(retryBtn.dataset.retryChatId || ""),
      String(retryBtn.dataset.retryMsgId || "")
    );
    return;
  }

  const copyBtn = target.closest("button[data-copy-type][data-msg-id]");
  const downloadBtn = target.closest("button[data-download-type][data-msg-id]");
  if (!(copyBtn instanceof HTMLButtonElement) && !(downloadBtn instanceof HTMLButtonElement)) {
    return;
  }

  const isCopy = copyBtn instanceof HTMLButtonElement;
  const sourceBtn = isCopy ? copyBtn : downloadBtn;
  const messageId = sourceBtn?.dataset.msgId;
  const chat = getActiveChat();
  const match = chat.messages.find((msg) => String(msg.id || "") === String(messageId || ""));
  if (!match || match.role !== "assistant") {
    statusEl.textContent = "Could not find that assistant message.";
    return;
  }

  try {
    const markdown = String(match.content || "");
    if (isCopy) {
      const copyType = copyBtn.dataset.copyType;
      if (copyType === "markdown") {
        await navigator.clipboard.writeText(markdown);
        statusEl.textContent = "Assistant markdown copied.";
        return;
      }

      if (copyType === "text") {
        await navigator.clipboard.writeText(markdownToPlainText(markdown));
        statusEl.textContent = "Assistant plain text copied.";
        return;
      }

      if (copyType === "html") {
        const renderedHtml = renderMarkdown(markdown);
        await copyHtmlToClipboard(renderedHtml, markdownToPlainText(markdown));
        statusEl.textContent = "Assistant rendered HTML copied.";
        return;
      }

      statusEl.textContent = "Unsupported copy mode.";
      return;
    }

    const downloadType = downloadBtn.dataset.downloadType;
    const payload = getAssistantMessageDownloadPayload(match, downloadType);
    if (!payload) {
      statusEl.textContent = "Unsupported download mode.";
      return;
    }
    triggerDownload(payload.content, payload.mimeType, payload.fileName);
    statusEl.textContent = `Assistant ${payload.label} downloaded.`;
  } catch {
    statusEl.textContent = isCopy ? "Clipboard copy failed." : "Download failed.";
  }
});

copyAllAssistantBtnEl.addEventListener("click", async () => {
  const chat = getActiveChat();
  const assistantReplies = chat.messages
    .filter((msg) => msg.role === "assistant")
    .map((msg, index) => `## Reply ${index + 1}\n\n${msg.content || ""}`)
    .join("\n\n---\n\n");

  if (!assistantReplies.trim()) {
    statusEl.textContent = "No assistant replies to copy.";
    return;
  }

  try {
    await navigator.clipboard.writeText(assistantReplies);
    statusEl.textContent = "All assistant replies copied as markdown.";
  } catch {
    statusEl.textContent = "Clipboard copy failed.";
  }
});

if (contextScopeSelectEl) {
  contextScopeSelectEl.addEventListener("change", () => {
    contextScope = contextScopeSelectEl.value === "global" ? "global" : "chat";
    renderContextPanel();
    setContextStatus(contextScope === "global"
      ? "Showing context sent with every chat in this browser."
      : "Showing context sent with the active chat only.");
  });
}

for (const disclosureEl of persistedDisclosureEls) {
  const storageKey = disclosureEl.dataset.disclosureStorageKey;
  disclosureEl.open = storageGet(storageKey) === "1";
  disclosureEl.addEventListener("toggle", () => {
    storageSet(storageKey, disclosureEl.open ? "1" : "0");
  });
}

if (addContextEntryBtnEl) {
  addContextEntryBtnEl.addEventListener("click", () => {
    const scope = getContextScope();
    const entries = getContextEntriesForScope(scope);
    if (entries.length >= CONTEXT_MAX_ENTRIES) {
      setContextStatus(`Limit reached (${CONTEXT_MAX_ENTRIES} entries).`);
      return;
    }

    setContextEntriesForScope(scope, [
      ...entries,
      { id: uid(), label: "New context", content: "", enabled: true }
    ]);
    renderContextPanel();
    setContextStatus("Entry added. Give it a label and content.");
    const lastTextarea = contextListEl?.querySelector("li:last-child textarea");
    if (lastTextarea instanceof HTMLTextAreaElement) {
      lastTextarea.focus();
    }
  });
}

if (copyContextPreambleBtnEl) {
  copyContextPreambleBtnEl.addEventListener("click", async () => {
    const preamble = buildContextPreamble(getActiveChat());
    if (!preamble) {
      setContextStatus("No enabled context entries to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(preamble);
      setContextStatus("Context preamble copied.");
    } catch {
      setContextStatus("Clipboard copy failed.");
    }
  });
}

if (contextListEl) {
  contextListEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.contextAction;
    if (action === "label" || action === "content") {
      const updatedEntry = updateContextEntryFromControl(target, action);
      if (action === "content" && updatedEntry) {
        const item = target.closest("li[data-context-id]");
        if (item) renderContextLineControls(item, updatedEntry);
      }
    }
  });

  contextListEl.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.contextAction === "toggle") {
      updateContextEntryFromControl(target, "toggle");
      target.closest("li[data-context-id]")?.classList.toggle("disabled", !target.checked);
    }
    if (target instanceof HTMLInputElement && target.dataset.contextAction === "line-toggle") {
      updateContextEntryFromControl(target, "line-toggle");
      target.closest(".context-line")?.classList.toggle("disabled", !target.checked);
    }
  });

  contextListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const removeBtn = target.closest("button[data-context-action='remove']");
    if (!(removeBtn instanceof HTMLButtonElement)) {
      return;
    }

    const entryId = removeBtn.closest("li[data-context-id]")?.dataset.contextId;
    if (!entryId) {
      return;
    }

    const scope = getContextScope();
    setContextEntriesForScope(scope, getContextEntriesForScope(scope).filter((entry) => entry.id !== entryId));
    renderContextPanel();
    setContextStatus("Entry removed.");
  });
}

if (refreshRenderBtnEl) {
  refreshRenderBtnEl.addEventListener("click", () => {
    const legacyCount = countStoredLegacyCodeTokens();
    renderMessages();
    statusEl.textContent = legacyCount > 0
      ? `Render refreshed. Found ${legacyCount} literal legacy CODETOKEN marker(s) saved in chat markdown; those cannot be reconstructed automatically.`
      : "Render refreshed with the current markdown/code renderer.";
  });
}

if (repairChatStateBtnEl) {
  repairChatStateBtnEl.addEventListener("click", () => {
    repairChatStateFromStorage();
  });
}

if (refreshToolRunsBtnEl) {
  refreshToolRunsBtnEl.addEventListener("click", () => {
    loadToolRuns();
  });
}

if (toolRunsFilterSelectEl) {
  toolRunsFilterSelectEl.value = getToolRunsFilter();
  toolRunsFilterSelectEl.addEventListener("change", () => {
    localStorage.setItem(TOOL_RUNS_FILTER_STORAGE_KEY, toolRunsFilterSelectEl.value);
    loadToolRuns();
  });
}

modelSelectEl.addEventListener("change", () => {
  const chat = getActiveChat();
  chat.model = modelSelectEl.value;
  saveState();
  renderAll();
});

if (reasoningEffortSelectEl) {
  reasoningEffortSelectEl.addEventListener("change", () => {
    const chat = getActiveChat();
    const value = normalizeReasoningEffort(reasoningEffortSelectEl.value);
    const options = getReasoningEffortOptions(chat.provider, chat.model);
    chat.reasoningEffort = options.includes(value) ? value : "";
    saveState();
    statusEl.textContent = chat.reasoningEffort
      ? `Reasoning effort set to ${chat.reasoningEffort}.`
      : "Reasoning effort set to model default.";
  });
}

if (agentStepOverrideInputEl) {
  agentStepOverrideInputEl.addEventListener("change", () => {
    const chat = getActiveChat();
    const raw = String(agentStepOverrideInputEl.value || "").trim();
    if (!raw) {
      chat.agentMaxStepsOverride = null;
      saveState();
      statusEl.textContent = "Per-chat step override cleared.";
      return;
    }
    const max = Number(config?.agentStepOverride?.maxOverrideSteps || 40);
    const value = Math.max(1, Math.min(max, Number(raw)));
    if (!Number.isInteger(value)) {
      statusEl.textContent = "Step override must be an integer.";
      return;
    }
    chat.agentMaxStepsOverride = value;
    agentStepOverrideInputEl.value = String(value);
    saveState();
    statusEl.textContent = `Per-chat step override set to ${value}.`;
  });
}

if (agentStepOverrideCodeInputEl) {
  agentStepOverrideCodeInputEl.addEventListener("change", () => {
    const chat = getActiveChat();
    chat.agentMaxStepsOverrideCode = String(agentStepOverrideCodeInputEl.value || "").trim();
    saveState();
    statusEl.textContent = chat.agentMaxStepsOverrideCode
      ? "Per-chat step override code saved."
      : "Per-chat step override code cleared.";
  });
}

providerSelectEl.addEventListener("change", () => {
  const chat = getActiveChat();
  chat.provider = normalizeProvider(providerSelectEl.value) || config.defaultProvider;
  saveState();
  renderAll();
});

agentModeToggleEl.addEventListener("change", () => {
  localStorage.setItem(AGENT_MODE_STORAGE_KEY, agentModeToggleEl.checked ? "true" : "false");
  statusEl.textContent = agentModeToggleEl.checked ? "Agent tools enabled." : "Agent tools disabled.";
});

if (notificationToggleEl) {
  notificationToggleEl.checked = notificationsEnabled();
  notificationToggleEl.addEventListener("change", async () => {
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, notificationToggleEl.checked ? "true" : "false");
    if (notificationToggleEl.checked && "Notification" in window && Notification.permission === "default") {
      try {
        await Notification.requestPermission();
      } catch {
        // Ignore permission prompt failures.
      }
    }
    statusEl.textContent = notificationToggleEl.checked ? "Notifications enabled." : "Notifications disabled.";
  });
}

if (notificationSoundToggleEl) {
  notificationSoundToggleEl.checked = notificationSoundEnabled();
  notificationSoundToggleEl.addEventListener("change", () => {
    localStorage.setItem(NOTIFICATIONS_SOUND_ENABLED_KEY, notificationSoundToggleEl.checked ? "true" : "false");
    statusEl.textContent = notificationSoundToggleEl.checked ? "Notification sound enabled." : "Notification sound disabled.";
  });
}

if (notifyInfoToggleEl && notifySuccessToggleEl && notifyWarningToggleEl && notifyErrorToggleEl) {
  const levels = getNotificationLevelsConfig();
  notifyInfoToggleEl.checked = levels.info;
  notifySuccessToggleEl.checked = levels.success;
  notifyWarningToggleEl.checked = levels.warning;
  notifyErrorToggleEl.checked = levels.error;

  const saveLevels = () => {
    setNotificationLevelsConfig({
      info: notifyInfoToggleEl.checked,
      success: notifySuccessToggleEl.checked,
      warning: notifyWarningToggleEl.checked,
      error: notifyErrorToggleEl.checked
    });
    statusEl.textContent = "Notification severity settings updated.";
  };

  notifyInfoToggleEl.addEventListener("change", saveLevels);
  notifySuccessToggleEl.addEventListener("change", saveLevels);
  notifyWarningToggleEl.addEventListener("change", saveLevels);
  notifyErrorToggleEl.addEventListener("change", saveLevels);
}

if (notifyDebounceInputEl) {
  notifyDebounceInputEl.value = String(getNotificationDebounceMs());
  notifyDebounceInputEl.addEventListener("change", () => {
    const next = setNotificationDebounceMs(notifyDebounceInputEl.value);
    notifyDebounceInputEl.value = String(next);
    statusEl.textContent = `Notification debounce set to ${next}ms.`;
  });
}

sendBtnEl.addEventListener("click", sendPrompt);
if (cancelJobBtnEl) {
  cancelJobBtnEl.addEventListener("click", cancelActiveChatJob);
}
if (copyTraceBtnEl) {
  copyTraceBtnEl.addEventListener("click", async () => {
    if (!currentTraceId) {
      statusEl.textContent = "No trace ID available yet.";
      return;
    }
    try {
      await navigator.clipboard.writeText(currentTraceId);
      statusEl.textContent = "Trace ID copied.";
    } catch {
      statusEl.textContent = "Clipboard copy failed.";
    }
  });
}
if (copyTraceAuditUrlBtnEl) {
  copyTraceAuditUrlBtnEl.addEventListener("click", async () => {
    const url = getFilteredAuditUrl(currentTraceId);
    const absolute = new URL(url, window.location.href).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      statusEl.textContent = "Filtered audit URL copied.";
    } catch {
      statusEl.textContent = "Clipboard copy failed.";
    }
  });
}
if (autoOpenTraceAuditToggleEl) {
  autoOpenTraceAuditToggleEl.checked = autoOpenTraceAuditEnabled();
  autoOpenTraceAuditToggleEl.addEventListener("change", () => {
    localStorage.setItem(AUTO_OPEN_TRACE_AUDIT_KEY, autoOpenTraceAuditToggleEl.checked ? "true" : "false");
    statusEl.textContent = autoOpenTraceAuditToggleEl.checked
      ? "Auto-open filtered audit enabled."
      : "Auto-open filtered audit disabled.";
  });
}
promptEl.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    sendPrompt();
  }
});

if (workspaceSwitchBtnEl) {
  workspaceSwitchBtnEl.addEventListener("click", switchWorkspace);
}

if (workspaceCodeInputEl) {
  workspaceCodeInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      switchWorkspace();
    }
  });
}

window.addEventListener("storage", (event) => {
  if (event.key === FILELAB_SYNTAX_THEME_KEY) {
    applyCodeThemeFromFileLab();
  }
});

initTheme();
applyCodeThemeFromFileLab();
await loadConfig();
await loadModelCatalog();
await loadWorkspaceInfo();
saveState();
renderAll();
loadToolRuns();
updateTracePanel("", "");
startNotificationPolling();
