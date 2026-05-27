const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const refreshNotificationsBtnEl = document.getElementById("refreshNotificationsBtn");
const notificationsStatusEl = document.getElementById("notificationsStatus");
const notificationsListEl = document.getElementById("notificationsList");
const notificationsJsonEl = document.getElementById("notificationsJson");

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

function formatTime(isoValue) {
  try {
    return new Date(isoValue).toLocaleString();
  } catch {
    return String(isoValue || "");
  }
}

async function loadNotifications() {
  notificationsStatusEl.textContent = "Loading...";
  try {
    const response = await fetch("/api/notifications?limit=100", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load notifications");
    }

    const rows = Array.isArray(data?.notifications) ? data.notifications : [];
    notificationsListEl.innerHTML = "";

    if (rows.length === 0) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.textContent = "No notifications yet.";
      notificationsListEl.appendChild(li);
    } else {
      for (const item of rows) {
        const li = document.createElement("li");
        li.className = "file-item";
        li.textContent = `[${String(item.level || "info").toUpperCase()}] ${formatTime(item.timestamp)} :: ${item.message || ""}`;
        notificationsListEl.appendChild(li);
      }
    }

    notificationsJsonEl.textContent = JSON.stringify({ notifications: rows }, null, 2);
    notificationsStatusEl.textContent = `Loaded ${rows.length} notification(s).`;
  } catch (error) {
    notificationsStatusEl.textContent = `Error: ${error.message}`;
    notificationsJsonEl.textContent = "{}";
    notificationsListEl.innerHTML = "";
  }
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

refreshNotificationsBtnEl.addEventListener("click", () => {
  loadNotifications();
});

initTheme();
loadNotifications();
