const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const snapshotMessageInputEl = document.getElementById("snapshotMessageInput");
const createSnapshotBtnEl = document.getElementById("createSnapshotBtn");
const refreshSnapshotsBtnEl = document.getElementById("refreshSnapshotsBtn");
const snapshotsStatusEl = document.getElementById("snapshotsStatus");
const snapshotsListEl = document.getElementById("snapshotsList");

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

function formatDate(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value || "");
  }
}

async function loadSnapshots() {
  snapshotsStatusEl.textContent = "Loading snapshots...";
  snapshotsListEl.innerHTML = "";

  try {
    const response = await fetch("/api/files/snapshots?limit=80", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load snapshots");
    }

    const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
    if (snapshots.length === 0) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.textContent = "No snapshots found yet.";
      li.style.cursor = "default";
      snapshotsListEl.appendChild(li);
      snapshotsStatusEl.textContent = "No snapshots available.";
      return;
    }

    for (const item of snapshots) {
      const li = document.createElement("li");
      li.className = "file-item";
      li.style.cursor = "default";

      const title = document.createElement("div");
      title.innerHTML = `<strong>${item.shortHash || ""}</strong> ${item.subject || ""}`;

      const meta = document.createElement("div");
      meta.style.marginTop = "4px";
      meta.textContent = `${item.hash || ""} | ${formatDate(item.date)}`;

      const actions = document.createElement("div");
      actions.className = "top-actions";
      actions.style.marginTop = "8px";

      const restoreBtn = document.createElement("button");
      restoreBtn.className = "btn btn-soft danger";
      restoreBtn.type = "button";
      restoreBtn.textContent = "Restore";
      restoreBtn.addEventListener("click", async () => {
        const ok = window.confirm(`Restore snapshot ${item.shortHash}? This resets sandbox state.`);
        if (!ok) {
          return;
        }
        snapshotsStatusEl.textContent = `Restoring ${item.shortHash}...`;
        try {
          const responseRestore = await fetch("/api/files/snapshots/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ref: item.hash })
          });
          const dataRestore = await responseRestore.json();
          if (!responseRestore.ok) {
            throw new Error(dataRestore.error || "Restore failed");
          }
          snapshotsStatusEl.textContent = `Restored snapshot ${item.shortHash}.`;
          await loadSnapshots();
        } catch (error) {
          snapshotsStatusEl.textContent = `Error: ${error.message}`;
        }
      });

      actions.appendChild(restoreBtn);
      li.appendChild(title);
      li.appendChild(meta);
      li.appendChild(actions);
      snapshotsListEl.appendChild(li);
    }

    snapshotsStatusEl.textContent = `Loaded ${snapshots.length} snapshots.`;
  } catch (error) {
    snapshotsStatusEl.textContent = `Error: ${error.message}`;
  }
}

createSnapshotBtnEl.addEventListener("click", async () => {
  createSnapshotBtnEl.disabled = true;
  snapshotsStatusEl.textContent = "Creating snapshot...";
  try {
    const response = await fetch("/api/files/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: snapshotMessageInputEl.value || "" })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to create snapshot");
    }
    snapshotMessageInputEl.value = "";
    snapshotsStatusEl.textContent = `Snapshot created: ${data?.snapshot?.shortHash || "ok"}.`;
    await loadSnapshots();
  } catch (error) {
    snapshotsStatusEl.textContent = `Error: ${error.message}`;
  } finally {
    createSnapshotBtnEl.disabled = false;
  }
});

refreshSnapshotsBtnEl.addEventListener("click", () => {
  loadSnapshots();
});

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

initTheme();
loadSnapshots();
