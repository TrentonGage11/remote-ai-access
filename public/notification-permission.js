const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const permissionStatusEl = document.getElementById("permissionStatus");
const requestPermissionBtnEl = document.getElementById("requestPermissionBtn");
const sendTestNotificationBtnEl = document.getElementById("sendTestNotificationBtn");

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

function setPermissionStatus(message) {
  permissionStatusEl.textContent = message;
}

function getPermissionState() {
  if (!("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

function updateUiFromPermission() {
  const state = getPermissionState();
  if (state === "unsupported") {
    setPermissionStatus("This browser does not support desktop notifications.");
    requestPermissionBtnEl.disabled = true;
    sendTestNotificationBtnEl.disabled = true;
    return;
  }

  if (state === "granted") {
    setPermissionStatus("Permission granted. Desktop notifications are enabled for this site.");
    requestPermissionBtnEl.disabled = false;
    sendTestNotificationBtnEl.disabled = false;
    return;
  }

  if (state === "denied") {
    setPermissionStatus("Permission denied. Enable notifications in browser site settings to allow them.");
    requestPermissionBtnEl.disabled = false;
    sendTestNotificationBtnEl.disabled = true;
    return;
  }

  setPermissionStatus("Permission not requested yet. Click the button below to request access.");
  requestPermissionBtnEl.disabled = false;
  sendTestNotificationBtnEl.disabled = true;
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    updateUiFromPermission();
    return;
  }

  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      setPermissionStatus("Permission granted. You can now receive desktop notifications.");
    } else if (result === "denied") {
      setPermissionStatus("Permission denied. You can re-enable it from browser site settings.");
    } else {
      setPermissionStatus("Permission request dismissed. Notifications remain disabled.");
    }
  } catch (error) {
    setPermissionStatus(`Permission request failed: ${error.message}`);
  }

  updateUiFromPermission();
}

function sendTestNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    updateUiFromPermission();
    return;
  }

  let note;
  try {
    note = new Notification("Remote AI Access", {
      body: `Test notification delivered at ${new Date().toLocaleTimeString()}.`,
      tag: `remote-ai-access-permission-test-${Date.now()}`,
      renotify: true,
      requireInteraction: true,
      silent: false
    });
  } catch (error) {
    setPermissionStatus(`Notification creation failed: ${error.message}`);
    return;
  }

  note.onclick = () => {
    window.focus();
    note.close();
  };

  setPermissionStatus("Test notification sent. If no popup appears, check OS/browser notification center and site notification settings.");
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

requestPermissionBtnEl.addEventListener("click", () => {
  requestNotificationPermission();
});

sendTestNotificationBtnEl.addEventListener("click", () => {
  sendTestNotification();
});

initTheme();
updateUiFromPermission();
