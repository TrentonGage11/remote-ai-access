const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const refreshNotificationsBtnEl = document.getElementById("refreshNotificationsBtn");
const notificationsStatusEl = document.getElementById("notificationsStatus");
const notificationsListEl = document.getElementById("notificationsList");
const notificationsJsonEl = document.getElementById("notificationsJson");
const questionsListEl = document.getElementById("questionsList");

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

function renderQuestions(rows) {
  questionsListEl.replaceChildren();
  const questions = rows.filter((item) => item?.metadata?.kind === "user-question" && item.metadata.jobId);
  if (questions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-inline";
    empty.textContent = "No workflows are waiting for an answer.";
    questionsListEl.appendChild(empty);
    return;
  }
  for (const item of questions) {
    const card = document.createElement("article");
    card.className = "notification-question";
    const prompt = document.createElement("strong");
    prompt.textContent = String(item.message || "Agent question").replace(/^Agent question:\s*/i, "");
    const meta = document.createElement("span");
    meta.className = "muted-inline";
    meta.textContent = formatTime(item.timestamp);
    const actions = document.createElement("div");
    actions.className = "notification-question-actions";
    const choices = Array.isArray(item.metadata.choices) ? item.metadata.choices : [];
    const answer = async (value, status) => {
      actions.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
      status.textContent = "Submitting answer…";
      try {
        const response = await fetch(`/api/chat/jobs/${encodeURIComponent(item.metadata.jobId)}/input`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: item.metadata.questionId, answer: value })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to submit answer");
        status.textContent = "Answered; workflow resumed.";
        await loadNotifications();
      } catch (error) {
        status.textContent = `Answer error: ${error.message}`;
        actions.querySelectorAll("button, input").forEach((control) => { control.disabled = false; });
      }
    };
    const status = document.createElement("span");
    status.className = "muted-inline";
    if (choices.length > 0) {
      for (const choice of choices) {
        const button = document.createElement("button");
        button.className = "btn btn-soft";
        button.type = "button";
        button.textContent = choice;
        button.addEventListener("click", () => answer(choice, status));
        actions.appendChild(button);
      }
    } else {
      const input = document.createElement("input");
      input.className = "notification-question-input";
      input.placeholder = "Type your answer";
      const button = document.createElement("button");
      button.className = "btn";
      button.type = "button";
      button.textContent = "Answer";
      button.addEventListener("click", () => answer(input.value, status));
      actions.append(input, button);
    }
    card.append(prompt, meta, actions, status);
    questionsListEl.appendChild(card);
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
    renderQuestions(rows);

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
