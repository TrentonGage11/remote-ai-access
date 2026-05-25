const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const testProfileSelectEl = document.getElementById("testProfileSelect");
const testCwdSelectEl = document.getElementById("testCwdSelect");
const testTimeoutInputEl = document.getElementById("testTimeoutInput");
const runTestBtnEl = document.getElementById("runTestBtn");
const testStatusEl = document.getElementById("testStatus");
const testFailuresListEl = document.getElementById("testFailuresList");
const testOutputEl = document.getElementById("testOutput");

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

function renderFailures(failures) {
  testFailuresListEl.innerHTML = "";
  if (!Array.isArray(failures) || failures.length === 0) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.style.cursor = "default";
    li.textContent = "No failure lines detected.";
    testFailuresListEl.appendChild(li);
    return;
  }

  for (const line of failures) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.style.cursor = "default";

    const match = /([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?/.exec(String(line || ""));
    if (match) {
      const rawPath = String(match[1] || "").replaceAll("\\", "/");
      const path = rawPath.replace(/^\/+/, "");
      const lineNo = Number(match[2] || 1);
      const colNo = Number(match[3] || 1);

      const text = document.createElement("span");
      text.textContent = `${line} `;
      const open = document.createElement("a");
      open.className = "btn btn-soft";
      open.href = `filelab.html?path=${encodeURIComponent(path)}&line=${lineNo}&col=${colNo}`;
      open.textContent = "Open in File Lab";
      li.appendChild(text);
      li.appendChild(open);
    } else {
      li.textContent = line;
    }
    testFailuresListEl.appendChild(li);
  }
}

async function loadProfiles() {
  testStatusEl.textContent = "Loading profiles...";
  try {
    const response = await fetch("/api/tests/profiles", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load profiles");
    }

    const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
    testProfileSelectEl.innerHTML = "";
    for (const item of profiles) {
      const opt = document.createElement("option");
      opt.value = item.profile;
      opt.textContent = `${item.profile} - ${item.description}`;
      testProfileSelectEl.appendChild(opt);
    }

    testStatusEl.textContent = `Loaded ${profiles.length} profiles.`;
  } catch (error) {
    testStatusEl.textContent = `Error: ${error.message}`;
  }
}

async function runTests() {
  runTestBtnEl.disabled = true;
  testStatusEl.textContent = "Running test profile...";
  testOutputEl.textContent = "Running...";

  try {
    const response = await fetch("/api/tests/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: testProfileSelectEl.value,
        cwd: testCwdSelectEl.value,
        timeoutMs: Number(testTimeoutInputEl.value || 120000)
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Test run failed");
    }

    const statusText = data.ok
      ? `PASS: ${data.profile} (exit ${data.exitCode})`
      : `FAIL: ${data.profile} (exit ${data.exitCode})`;
    testStatusEl.textContent = statusText;
    renderFailures(data.failures || []);

    testOutputEl.textContent = JSON.stringify({
      ok: data.ok,
      profile: data.profile,
      cwd: data.cwd,
      command: `${data.command} ${(data.args || []).join(" ")}`,
      exitCode: data.exitCode,
      failures: data.failures || [],
      stdout: data.stdout || "",
      stderr: data.stderr || ""
    }, null, 2);
  } catch (error) {
    testStatusEl.textContent = `Error: ${error.message}`;
    testOutputEl.textContent = "{}";
    renderFailures([]);
  } finally {
    runTestBtnEl.disabled = false;
  }
}

runTestBtnEl.addEventListener("click", runTests);

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

initTheme();
loadProfiles();
