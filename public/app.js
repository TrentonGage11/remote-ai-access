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
const copyAllAssistantBtnEl = document.getElementById("copyAllAssistantBtn");
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

const FALLBACK_MODELS = ["gpt-5.5", "gpt-5.3-codex", "gpt-5", "gpt-4.1"];
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
  xaiDefaultModel: "grok-4.3",
  ollamaDefaultModel: "",
  allowedModels: [],
  xaiAllowedModels: [],
  ollamaAllowedModels: [],
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
    url.searchParams.set("access_code", code);
    window.location.href = url.toString();
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

  const chats = parsed.chats.map((chat) => ({
    ...chat,
    provider: normalizeProvider(chat?.provider) || "openai",
    model: typeof chat?.model === "string" && chat.model ? chat.model : config.defaultModel,
    reasoningEffort: normalizeReasoningEffort(chat?.reasoningEffort),
    agentMaxStepsOverride: Number.isInteger(Number(chat?.agentMaxStepsOverride)) ? Number(chat.agentMaxStepsOverride) : null,
    agentMaxStepsOverrideCode: typeof chat?.agentMaxStepsOverrideCode === "string" ? chat.agentMaxStepsOverrideCode : "",
    messages: Array.isArray(chat?.messages) ? chat.messages : []
  }));

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

  const primary = parseStateJson(localStorage.getItem(CHAT_STATE_KEY));
  if (primary) {
    candidates.push(primary);
  }

  const exportState = parseStateJson(localStorage.getItem(HISTORY_EXPORT_KEY));
  if (exportState) {
    candidates.push(exportState);
  }

  for (const key of LEGACY_CHAT_STATE_KEYS) {
    const legacy = parseStateJson(localStorage.getItem(key));
    if (legacy) {
      candidates.push(legacy);
    }
  }

  try {
    const backupsRaw = localStorage.getItem(CHAT_BACKUPS_KEY);
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
    const existing = JSON.parse(localStorage.getItem(CHAT_BACKUPS_KEY) || "[]");
    backups = Array.isArray(existing) ? existing : [];
  } catch {
    backups = [];
  }

  const alreadyExists = backups.some((item) => item?.checksum === checksum);
  if (!alreadyExists) {
    backups.unshift(nextEntry);
    backups = backups.slice(0, 15);
    localStorage.setItem(CHAT_BACKUPS_KEY, JSON.stringify(backups));
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
  persistBackupSnapshot(localStorage.getItem(CHAT_STATE_KEY));
  persistBackupSnapshot(localStorage.getItem(HISTORY_EXPORT_KEY));

  const persistedBest = chooseBestState(getPersistedStateCandidates());
  const currentCount = countMessages(state);
  const persistedCount = countMessages(persistedBest);

  if (currentCount === 0 && persistedCount > 0) {
    state = persistedBest;
  }

  localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(state));
  localStorage.setItem(HISTORY_EXPORT_KEY, JSON.stringify(state, null, 2));
}

function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || state.chats[0];
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

function replaceTokenMatches(text, regex, className, placeholders) {
  return text.replace(regex, (match) => {
    const token = `@@CODETOKEN_${placeholders.length}@@`;
    placeholders.push(`<span class="tok-${className}">${match}</span>`);
    return token;
  });
}

function restoreTokenMatches(text, placeholders) {
  let output = text;
  for (let i = 0; i < placeholders.length; i += 1) {
    output = output.replaceAll(`@@CODETOKEN_${i}@@`, placeholders[i]);
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
    const token = `@@CODETOKEN_${placeholders.length}@@`;
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

  for (const msg of chat.messages) {
    const item = document.createElement("li");
    item.className = `msg ${msg.role}`;
    const copyButton = msg.role === "assistant"
      ? `
        <button type="button" class="copy-md-btn" data-copy-type="markdown" data-msg-id="${escapeHtml(String(msg.id || ""))}">MD</button>
        <button type="button" class="copy-md-btn" data-copy-type="text" data-msg-id="${escapeHtml(String(msg.id || ""))}">Text</button>
        <button type="button" class="copy-md-btn" data-copy-type="html" data-msg-id="${escapeHtml(String(msg.id || ""))}">HTML</button>
      `
      : "";
    item.innerHTML = `
      <div class="msg-head">
        <div class="msg-head-left">
          <strong>${msg.role === "user" ? "You" : "Assistant"}</strong>
          ${copyButton}
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

function updateModelSelect() {
  const chat = getActiveChat();
  const provider = normalizeProvider(chat.provider) || config.defaultProvider;
  const modelByTag = new Map(
    modelCatalog
      .filter((entry) => entry.provider === provider)
      .map((entry) => [entry.tag, entry])
  );

  const providerModels = modelCatalog
    .filter((entry) => entry.provider === provider && CHAT_CAPABLE_TYPES.has(entry.type))
    .map((entry) => entry.tag);

  let opts = providerModels.length > 0
    ? [...new Set(providerModels)]
    : [...new Set([
      provider === "xai" ? config.xaiDefaultModel : provider === "ollama" ? config.ollamaDefaultModel : config.defaultModel,
      ...FALLBACK_MODELS
    ].filter(Boolean))];

  const providerAllowedModels = provider === "xai"
    ? config.xaiAllowedModels
    : provider === "ollama"
      ? config.ollamaAllowedModels
    : config.allowedModels;

  if (providerAllowedModels.length > 0) {
    opts = opts.filter((item) => providerAllowedModels.includes(item));
    if (opts.length === 0) {
      opts = [...providerAllowedModels];
    }
  }

  modelSelectEl.innerHTML = "";

  for (const model of opts) {
    const catalogEntry = modelByTag.get(model);
    const opt = document.createElement("option");
    opt.value = model;
    const suffix = provider === "ollama"
      ? catalogEntry?.supportsTools
        ? " - Agent tools"
        : " - Chat only"
      : "";
    opt.textContent = `${model}${suffix}`;
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
  renderTabs();
  updateProviderSelect();
  updateModelSelect();
  syncReasoningEffortControl();
  syncAgentModeToggle();
  renderMessages();
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

function getModelCatalogEntry(provider, model) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedModel = String(model || "").trim();
  if (!normalizedProvider || !normalizedModel) {
    return null;
  }
  return modelCatalog.find((entry) => entry.provider === normalizedProvider && entry.tag === normalizedModel) || null;
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
  const providerSupported = (config.agentModeSupportedProviders || []).includes(provider);
  const modelEntry = getModelCatalogEntry(provider, chat.model);
  const modelSupportsTools = provider === "ollama" ? Boolean(modelEntry?.supportsTools) : true;
  const supported = providerSupported && modelSupportsTools;
  agentModeToggleEl.disabled = !supported;
  if (!supported) {
    agentModeToggleEl.checked = false;
    agentModeToggleEl.title = !providerSupported
      ? "Agent tools are not enabled for this provider."
      : "This model is chat-only and does not advertise Ollama tool support.";
    return;
  }
  agentModeToggleEl.title = "Enable agent tool calling.";
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
    if (typeof data?.ollamaDefaultModel === "string") {
      config.ollamaDefaultModel = data.ollamaDefaultModel;
    }
    if (Array.isArray(data?.allowedModels)) {
      config.allowedModels = data.allowedModels.filter((item) => typeof item === "string" && item);
    }
    if (Array.isArray(data?.xaiAllowedModels)) {
      config.xaiAllowedModels = data.xaiAllowedModels.filter((item) => typeof item === "string" && item);
    }
    if (Array.isArray(data?.ollamaAllowedModels)) {
      config.ollamaAllowedModels = data.ollamaAllowedModels.filter((item) => typeof item === "string" && item);
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
    const response = await fetch("/api/models", { cache: "no-store" });
    if (response.ok) {
      const data = await parseJsonResponse(response);
      if (Array.isArray(data?.models)) {
        modelCatalog = data.models
          .map((entry) => ({
            provider: normalizeProvider(entry.provider) || "openai",
            name: typeof entry.name === "string" ? entry.name : "",
            tag: typeof entry.tag === "string" ? entry.tag : "",
            type: normalizeProvider(entry.type || "chatgpt"),
            reasoningEfforts: Array.isArray(entry.reasoningEfforts)
              ? entry.reasoningEfforts.map((item) => normalizeReasoningEffort(item)).filter(Boolean)
              : [],
            capabilities: Array.isArray(entry.capabilities)
              ? entry.capabilities.map((item) => String(item || "").trim()).filter(Boolean)
              : [],
            supportsTools: Boolean(entry.supportsTools)
          }))
          .filter((entry) => /^[a-zA-Z0-9._:/-]{2,120}$/.test(entry.tag));
        return;
      }
    }
  } catch {
    // Fall back to the static CSV below.
  }

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
          : [],
        capabilities: [],
        supportsTools: false
      }))
      .filter((entry) => /^[a-zA-Z0-9._:/-]{2,120}$/.test(entry.tag));
  } catch {
    modelCatalog = [];
  }    
}

async function sendPrompt() {
  const chat = getActiveChat();
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

  sendBtnEl.disabled = true;
  statusEl.textContent = `Thinking with ${chat.provider}:${chat.model}...`;

  try {
    const payloadMessages = buildPayloadMessages(chat.messages);

    const requestBody = {
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
      messages: payloadMessages
    };

    const { response, data } = agentModeToggleEl.checked
      ? await sendPromptViaJob(requestBody)
      : await postChatWithRetry(requestBody);
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    chat.messages.push({
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
      chat.model = data.model;
    }

    saveState();
    renderAll();
    loadToolRuns();
    const usedTools = Array.isArray(data.executedTools) ? data.executedTools : [];
    if (data.contextCompaction?.applied) {
      statusEl.textContent = `Done. Provider context was compacted (${data.contextCompaction.originalMessageCount || "?"} -> ${data.contextCompaction.sentMessageCount || "?"} messages); full chat remains archived.`;
    } else if (agentModeToggleEl.checked && usedTools.length === 0) {
      statusEl.textContent = "Done, but no tools were executed for this reply.";
    } else {
      statusEl.textContent = "Done.";
    }
  } catch (error) {
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

  const copyBtn = target.closest("button[data-copy-type][data-msg-id]");
  if (!(copyBtn instanceof HTMLButtonElement)) {
    return;
  }

  const messageId = copyBtn.dataset.msgId;
  const copyType = copyBtn.dataset.copyType;
  const chat = getActiveChat();
  const match = chat.messages.find((msg) => String(msg.id || "") === String(messageId || ""));
  if (!match || match.role !== "assistant") {
    statusEl.textContent = "Could not find that assistant message.";
    return;
  }

  try {
    const markdown = match.content || "";
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
  } catch {
    statusEl.textContent = "Clipboard copy failed.";
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
  const chat = getActiveChat();
  const provider = normalizeProvider(chat.provider);
  const modelEntry = getModelCatalogEntry(provider, chat.model);
  if (provider === "ollama" && !modelEntry?.supportsTools) {
    agentModeToggleEl.checked = false;
    localStorage.setItem(AGENT_MODE_STORAGE_KEY, "false");
    statusEl.textContent = "Agent tools unavailable for this chat-only Ollama model.";
    return;
  }
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
      await navigator.clipboard.writeText(currentTraceId);
      statusEl.textContent = "Trace ID copied.";
    } catch {
      statusEl.textContent = "Clipboard copy failed.";
    }
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
