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

const themeToggleEl = document.getElementById("themeToggle");
const downloadArchiveBtnEl = document.getElementById("downloadArchiveBtn");
const copyArchiveBtnEl = document.getElementById("copyArchiveBtn");
const repairArchiveStateBtnEl = document.getElementById("repairArchiveStateBtn");
const importMergeBtnEl = document.getElementById("importMergeBtn");
const importReplaceBtnEl = document.getElementById("importReplaceBtn");
const archiveFileInputEl = document.getElementById("archiveFileInput");
const archiveStatusEl = document.getElementById("archiveStatus");
const archiveJsonEl = document.getElementById("archiveJson");
const chatSummaryListEl = document.getElementById("chatSummaryList");

let pendingImportMode = "merge";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(password, salt) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 200000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptArchiveJson(plainJson, password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plainJson));

  return {
    format: "remote-ai-archive-v1",
    encrypted: true,
    kdf: "PBKDF2-SHA256",
    iterations: 200000,
    cipher: "AES-GCM-256",
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipher))
  };
}

async function decryptArchivePayload(payload, password) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const key = await deriveAesKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return dec.decode(plain);
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

function readArchive() {
  const raw = localStorage.getItem(CHAT_STATE_KEY);
  if (!raw) {
    return { activeChatId: null, chats: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.chats)) {
      return { activeChatId: null, chats: [] };
    }
    return {
      activeChatId: parsed.activeChatId || (parsed.chats[0]?.id || null),
      chats: parsed.chats
    };
  } catch {
    return { activeChatId: null, chats: [] };
  }
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

function repairArchiveState() {
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

  let repaired = chooseBestState(candidates);
  if (!repaired) {
    repaired = { activeChatId: null, chats: [] };
  }

  writeArchive(repaired);
  localStorage.setItem(HISTORY_EXPORT_KEY, JSON.stringify(repaired, null, 2));
  archiveStatusEl.textContent = `Chat state repaired. ${repaired.chats.length} chat(s), ${countMessages(repaired)} message(s).`;
  render();
}

function writeArchive(state) {
  localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(state));
}

function normalizeArchive(parsed) {
  if (!Array.isArray(parsed?.chats)) {
    throw new Error("Invalid archive: chats array is required");
  }

  const chats = parsed.chats.map((chat) => ({
    id: typeof chat.id === "string" && chat.id ? chat.id : uid(),
    title: typeof chat.title === "string" && chat.title ? chat.title : "Imported chat",
    provider: typeof chat.provider === "string" && chat.provider ? chat.provider : "openai",
    model: typeof chat.model === "string" && chat.model ? chat.model : "gpt-4.1",
    contextEntries: Array.isArray(chat.contextEntries)
      ? chat.contextEntries.filter((entry) => entry && typeof entry === "object")
      : [],
    createdAt: typeof chat.createdAt === "string" && chat.createdAt ? chat.createdAt : new Date().toISOString(),
    messages: Array.isArray(chat.messages)
      ? chat.messages
        .filter((msg) => (msg?.role === "user" || msg?.role === "assistant") && typeof msg?.content === "string")
        .map((msg) => ({
          id: typeof msg.id === "string" && msg.id ? msg.id : uid(),
          role: msg.role,
          content: msg.content,
          createdAt: typeof msg.createdAt === "string" && msg.createdAt ? msg.createdAt : new Date().toISOString(),
          traceId: typeof msg.traceId === "string" ? msg.traceId : "",
          executedTools: Array.isArray(msg.executedTools) ? msg.executedTools.filter((item) => typeof item === "string") : [],
          contextCompaction: msg.contextCompaction && typeof msg.contextCompaction === "object" ? msg.contextCompaction : null
        }))
      : []
  }));

  return {
    activeChatId: typeof parsed.activeChatId === "string" ? parsed.activeChatId : (chats[0]?.id || null),
    chats
  };
}

function mergeArchives(currentState, incomingState) {
  const existingIds = new Set(currentState.chats.map((chat) => chat.id));
  const merged = [...currentState.chats];

  for (const chat of incomingState.chats) {
    let id = chat.id;
    while (existingIds.has(id)) {
      id = `${chat.id}-${Math.random().toString(36).slice(2, 6)}`;
    }
    existingIds.add(id);
    merged.push({ ...chat, id });
  }

  return {
    activeChatId: currentState.activeChatId || merged[0]?.id || null,
    chats: merged
  };
}

function render() {
  const state = readArchive();
  archiveJsonEl.textContent = JSON.stringify(state, null, 2);

  chatSummaryListEl.innerHTML = "";
  for (const chat of state.chats) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.textContent = `${chat.title} | ${chat.provider}:${chat.model} | ${chat.messages.length} messages`;
    chatSummaryListEl.appendChild(li);
  }

  if (state.chats.length === 0) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.textContent = "No chats saved yet.";
    chatSummaryListEl.appendChild(li);
  }
}

async function handleImport(file) {
  const text = await file.text();
  const initial = JSON.parse(text);
  let archiveJsonText = text;

  if (initial?.encrypted === true) {
    const password = window.prompt("This archive is encrypted. Enter password:", "");
    if (!password) {
      throw new Error("Password is required to decrypt archive");
    }
    archiveJsonText = await decryptArchivePayload(initial, password);
  }

  const parsed = normalizeArchive(JSON.parse(archiveJsonText));
  const current = readArchive();

  if (pendingImportMode === "replace") {
    writeArchive(parsed);
    archiveStatusEl.textContent = `Imported ${parsed.chats.length} chats (replaced existing archive).`;
  } else {
    const merged = mergeArchives(current, parsed);
    writeArchive(merged);
    archiveStatusEl.textContent = `Imported ${parsed.chats.length} chats (merged).`;
  }

  render();
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

downloadArchiveBtnEl.addEventListener("click", () => {
  (async () => {
    const state = readArchive();
    const plainJson = JSON.stringify(state, null, 2);
    const password = window.prompt("Optional: set archive password for encryption (leave blank for plain JSON)", "");

    let payloadText = plainJson;
    let suffix = "json";
    if (password) {
      const encrypted = await encryptArchiveJson(plainJson, password);
      payloadText = JSON.stringify(encrypted, null, 2);
      suffix = "encrypted.json";
    }

    const blob = new Blob([payloadText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-archive-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.${suffix}`;
    a.click();
    URL.revokeObjectURL(url);
    archiveStatusEl.textContent = password ? "Encrypted archive downloaded." : "Archive downloaded.";
  })().catch((error) => {
    archiveStatusEl.textContent = `Archive download failed: ${error.message}`;
  });
});

copyArchiveBtnEl.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(archiveJsonEl.textContent || "{}");
    archiveStatusEl.textContent = "Archive JSON copied.";
  } catch {
    archiveStatusEl.textContent = "Clipboard copy failed.";
  }
});

if (repairArchiveStateBtnEl) {
  repairArchiveStateBtnEl.addEventListener("click", () => {
    try {
      repairArchiveState();
    } catch (error) {
      archiveStatusEl.textContent = `Repair failed: ${error.message}`;
    }
  });
}

importMergeBtnEl.addEventListener("click", () => {
  pendingImportMode = "merge";
  archiveFileInputEl.click();
});

importReplaceBtnEl.addEventListener("click", () => {
  pendingImportMode = "replace";
  archiveFileInputEl.click();
});

archiveFileInputEl.addEventListener("change", async () => {
  const [file] = archiveFileInputEl.files || [];
  if (!file) {
    return;
  }
  try {
    await handleImport(file);
  } catch (error) {
    archiveStatusEl.textContent = `Import failed: ${error.message}`;
  } finally {
    archiveFileInputEl.value = "";
  }
});

initTheme();
render();
