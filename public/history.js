const jsonOutputEl = document.getElementById("jsonOutput");
const themeToggleEl = document.getElementById("themeToggle");
const copyBtnEl = document.getElementById("copyBtn");
const repairHistoryStateBtnEl = document.getElementById("repairHistoryStateBtn");
const downloadBtnEl = document.getElementById("downloadBtn");
const historyStatusEl = document.getElementById("historyStatus");

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

function readHistoryJson() {
  const raw = localStorage.getItem(CHAT_STATE_KEY);
  if (!raw) {
    return JSON.stringify({ activeChatId: null, chats: [] }, null, 2);
  }

  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return JSON.stringify({ error: "Failed to parse local chat state." }, null, 2);
  }
}

function normalizeArchive(parsed) {
  if (!Array.isArray(parsed?.chats)) {
    return null;
  }

  const chats = parsed.chats.map((chat) => ({
    id: typeof chat?.id === "string" && chat.id ? chat.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: typeof chat?.title === "string" && chat.title ? chat.title : "Recovered chat",
    provider: typeof chat?.provider === "string" && chat.provider ? chat.provider : "openai",
    model: typeof chat?.model === "string" && chat.model ? chat.model : "gpt-4.1",
    contextEntries: Array.isArray(chat?.contextEntries)
      ? chat.contextEntries.filter((entry) => entry && typeof entry === "object")
      : [],
    createdAt: typeof chat?.createdAt === "string" && chat.createdAt ? chat.createdAt : new Date().toISOString(),
    messages: Array.isArray(chat?.messages)
      ? chat.messages
        .filter((msg) => (msg?.role === "user" || msg?.role === "assistant") && typeof msg?.content === "string")
        .map((msg) => ({
          id: typeof msg?.id === "string" && msg.id ? msg.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: msg.role,
          content: msg.content,
          createdAt: typeof msg?.createdAt === "string" && msg.createdAt ? msg.createdAt : new Date().toISOString(),
          traceId: typeof msg?.traceId === "string" ? msg.traceId : "",
          executedTools: Array.isArray(msg?.executedTools) ? msg.executedTools.filter((item) => typeof item === "string") : [],
          contextCompaction: msg?.contextCompaction && typeof msg.contextCompaction === "object" ? msg.contextCompaction : null
        }))
      : []
  }));

  const activeChatId = typeof parsed?.activeChatId === "string" && chats.some((chat) => chat.id === parsed.activeChatId)
    ? parsed.activeChatId
    : (chats[0]?.id || null);
  return { activeChatId, chats };
}

function parseStateCandidate(raw) {
  if (!raw || typeof raw !== "string") {
    return null;
  }
  try {
    return normalizeArchive(JSON.parse(raw));
  } catch {
    return null;
  }
}

function countMessages(state) {
  if (!state || !Array.isArray(state.chats)) {
    return 0;
  }
  return state.chats.reduce((total, chat) => total + (Array.isArray(chat.messages) ? chat.messages.length : 0), 0);
}

function chooseBestState(candidates) {
  const valid = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  if (valid.length === 0) {
    return null;
  }
  valid.sort((a, b) => {
    const messageDelta = countMessages(b) - countMessages(a);
    if (messageDelta !== 0) {
      return messageDelta;
    }
    return (b.chats?.length || 0) - (a.chats?.length || 0);
  });
  return valid[0] || null;
}

function repairHistoryState() {
  const candidates = [];
  candidates.push(parseStateCandidate(localStorage.getItem(CHAT_STATE_KEY)));
  candidates.push(parseStateCandidate(localStorage.getItem(HISTORY_EXPORT_KEY)));
  for (const key of LEGACY_CHAT_STATE_KEYS) {
    candidates.push(parseStateCandidate(localStorage.getItem(key)));
  }

  try {
    const backups = JSON.parse(localStorage.getItem(CHAT_BACKUPS_KEY) || "[]");
    if (Array.isArray(backups)) {
      for (const item of backups) {
        candidates.push(normalizeArchive(item?.state || {}));
      }
    }
  } catch {
    // Ignore unreadable backup blobs.
  }

  const repaired = chooseBestState(candidates) || { activeChatId: null, chats: [] };
  localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(repaired));
  localStorage.setItem(HISTORY_EXPORT_KEY, JSON.stringify(repaired, null, 2));
  renderJson();
  if (historyStatusEl) {
    historyStatusEl.textContent = `Chat state repaired. ${repaired.chats.length} chat(s), ${countMessages(repaired)} message(s).`;
  }
}

function renderJson() {
  jsonOutputEl.textContent = readHistoryJson();
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

copyBtnEl.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(jsonOutputEl.textContent || "");
    copyBtnEl.textContent = "Copied";
    setTimeout(() => {
      copyBtnEl.textContent = "Copy JSON";
    }, 1000);
  } catch {
    copyBtnEl.textContent = "Copy failed";
    setTimeout(() => {
      copyBtnEl.textContent = "Copy JSON";
    }, 1000);
  }
});

if (repairHistoryStateBtnEl) {
  repairHistoryStateBtnEl.addEventListener("click", () => {
    try {
      repairHistoryState();
    } catch (error) {
      if (historyStatusEl) {
        historyStatusEl.textContent = `Repair failed: ${error.message}`;
      }
    }
  });
}

downloadBtnEl.addEventListener("click", () => {
  const blob = new Blob([jsonOutputEl.textContent || "{}"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-history-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

initTheme();
renderJson();
