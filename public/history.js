const jsonOutputEl = document.getElementById("jsonOutput");
const themeToggleEl = document.getElementById("themeToggle");
const copyBtnEl = document.getElementById("copyBtn");
const downloadBtnEl = document.getElementById("downloadBtn");

const THEME_STORAGE_KEY = "remote-ai-access-theme";
const CHAT_STATE_KEY = "remote-ai-access-chat-state-v1";

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
