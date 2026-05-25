const tabListEl = document.getElementById("tabList");
const newChatBtnEl = document.getElementById("newChatBtn");
const messageListEl = document.getElementById("messageList");
const promptEl = document.getElementById("prompt");
const sendBtnEl = document.getElementById("sendBtn");
const statusEl = document.getElementById("status");
const themeToggleEl = document.getElementById("themeToggle");
const providerSelectEl = document.getElementById("providerSelect");
const modelSelectEl = document.getElementById("modelSelect");
const agentModeToggleEl = document.getElementById("agentModeToggle");
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

const THEME_STORAGE_KEY = "remote-ai-access-theme";
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

const FALLBACK_MODELS = ["gpt-5.5", "gpt-5.3-codex", "gpt-5", "gpt-4.1"];
const CHAT_CAPABLE_TYPES = new Set(["text", "code", "chatgpt", "research", "open-weight", "search", "tool"]);

let config = {
  defaultProvider: "openai",
  defaultModel: "gpt-4.1",
  allowedModels: [],
  supportedProviders: ["openai"],
  agentModeSupportedProviders: ["openai"]
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

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChat(overrides = {}) {
  return {
    id: uid(),
    title: "New chat",
    provider: config.defaultProvider,
    model: config.defaultModel,
    createdAt: new Date().toISOString(),
    messages: [],
    ...overrides
  };
}

function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStateShape(parsed) {
  if (!Array.isArray(parsed?.chats) || parsed.chats.length === 0) {
    return null;
  }

  const chats = parsed.chats.map((chat) => ({
    ...chat,
    provider: normalizeProvider(chat?.provider) || "openai",
    model: typeof chat?.model === "string" && chat.model ? chat.model : config.defaultModel,
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdown(markdown) {
  let text = escapeHtml(markdown || "");
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

  text = text.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const token = `@@FENCE_${fences.length}@@`;
    fences.push(`<pre><code>${code.trim()}</code></pre>`);
    return token;
  });

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
    `;
    messageListEl.appendChild(item);
  }

  chatPanelEl.scrollTop = chatPanelEl.scrollHeight;
}

function updateModelSelect() {
  const chat = getActiveChat();
  const provider = normalizeProvider(chat.provider) || config.defaultProvider;

  const providerModels = modelCatalog
    .filter((entry) => entry.provider === provider && CHAT_CAPABLE_TYPES.has(entry.type))
    .map((entry) => entry.tag);

  let opts = providerModels.length > 0
    ? [...new Set(providerModels)]
    : [...new Set([config.defaultModel, ...FALLBACK_MODELS])];

  if (config.allowedModels.length > 0) {
    opts = opts.filter((item) => config.allowedModels.includes(item));
    if (opts.length === 0) {
      opts = [...config.allowedModels];
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
  const providerSet = new Set(config.supportedProviders.map((item) => normalizeProvider(item)).filter(Boolean));
  for (const entry of modelCatalog) {
    providerSet.add(entry.provider);
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
  syncAgentModeToggle();
  renderMessages();
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

      if (filter === "agent" && operation !== "agent-tool") {
        continue;
      }

      if (filter === "file" && operation === "agent-tool") {
        continue;
      }

      const label = operation === "agent-tool"
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
      li.textContent = "No agent-tool runs yet.";
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
    if (Array.isArray(data?.allowedModels)) {
      config.allowedModels = data.allowedModels.filter((item) => typeof item === "string" && item);
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
    throw new Error(`Server returned non-JSON response (${response.status}): ${snippet || "empty body"}`);
  }
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
        type: normalizeProvider(parts[typeIndex])
      }))
      .filter((entry) => /^[a-zA-Z0-9._/-]{2,120}$/.test(entry.tag));
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
    const payloadMessages = chat.messages.slice(-24).map((item) => ({
      role: item.role,
      content: item.content
    }));

    const { response, data } = await postChatWithRetry({
      provider: chat.provider,
      model: chat.model,
      agentMode: agentModeToggleEl.checked,
      messages: payloadMessages
    });
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }

    chat.messages.push({
      id: uid(),
      role: "assistant",
      content: data.reply || "(No output returned)",
      createdAt: new Date().toISOString(),
      executedTools: Array.isArray(data.executedTools) ? data.executedTools : []
    });

    if (data.model) {
      chat.model = data.model;
    }

    saveState();
    renderAll();
    loadToolRuns();
    const usedTools = Array.isArray(data.executedTools) ? data.executedTools : [];
    if (agentModeToggleEl.checked && usedTools.length === 0) {
      statusEl.textContent = "Done, but no tools were executed for this reply.";
    } else {
      statusEl.textContent = "Done.";
    }
  } catch (error) {
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
  renderTabs();
});

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
promptEl.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    sendPrompt();
  }
});

initTheme();
await loadConfig();
await loadModelCatalog();
saveState();
renderAll();
loadToolRuns();
startNotificationPolling();
