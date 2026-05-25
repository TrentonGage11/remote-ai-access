const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const leftRefInputEl = document.getElementById("leftRefInput");
const rightRefInputEl = document.getElementById("rightRefInput");
const diffPathInputEl = document.getElementById("diffPathInput");
const runRefDiffBtnEl = document.getElementById("runRefDiffBtn");
const leftPathInputEl = document.getElementById("leftPathInput");
const rightPathInputEl = document.getElementById("rightPathInput");
const runPathDiffBtnEl = document.getElementById("runPathDiffBtn");
const mergeRefInputEl = document.getElementById("mergeRefInput");
const mergePathInputEl = document.getElementById("mergePathInput");
const mergeFromSnapshotBtnEl = document.getElementById("mergeFromSnapshotBtn");
const diffStatusEl = document.getElementById("diffStatus");
const diffOutputEl = document.getElementById("diffOutput");
const diffLeftOutputEl = document.getElementById("diffLeftOutput");
const diffRightOutputEl = document.getElementById("diffRightOutput");

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeDiffPath(rawPath) {
  const text = String(rawPath || "").trim().replaceAll("\\", "/");
  if (!text || text === "/dev/null") {
    return "";
  }

  let next = text.replace(/^[ab]\//, "");
  const sandboxIndex = next.lastIndexOf("/sandbox/");
  if (sandboxIndex >= 0) {
    next = next.slice(sandboxIndex + "/sandbox/".length);
  }
  return next.replace(/^\/+/, "");
}

function buildFileLabHref(filePath, lineNumber) {
  const normalizedPath = normalizeDiffPath(filePath);
  if (!normalizedPath) {
    return "";
  }

  const params = new URLSearchParams({ path: normalizedPath });
  if (Number.isFinite(Number(lineNumber)) && Number(lineNumber) > 0) {
    params.set("line", String(Number(lineNumber)));
    params.set("col", "1");
  }
  return `filelab.html?${params.toString()}`;
}

function renderFileLabLink(filePath, lineNumber, label) {
  const href = buildFileLabHref(filePath, lineNumber);
  const safeLabel = escapeHtml(label);
  if (!href) {
    return safeLabel;
  }
  return `<a class="diff-link" href="${href}">${safeLabel}</a>`;
}

function renderDiffLineWithGutter(filePath, lineNumber, text) {
  const safeText = escapeHtml(text || "");
  if (!Number.isFinite(Number(lineNumber)) || Number(lineNumber) <= 0) {
    return `     | ${safeText}`;
  }
  const lineLabel = String(Number(lineNumber)).padStart(4, " ");
  const href = buildFileLabHref(filePath, lineNumber);
  if (!href) {
    return `${lineLabel} | ${safeText}`;
  }
  return `<a class="diff-gutter-link" href="${href}">${lineLabel}</a> | ${safeText}`;
}

function renderRawDiffOutput(diffText) {
  const lines = String(diffText || "").split(/\r?\n/);
  const rendered = [];
  let currentPath = "";

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = normalizeDiffPath(match?.[2] || match?.[1] || "");
      rendered.push(renderFileLabLink(currentPath, 1, line));
      continue;
    }

    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const pathPart = line.slice(4).trim();
      const candidate = normalizeDiffPath(pathPart);
      if (candidate) {
        currentPath = candidate;
      }
      rendered.push(renderFileLabLink(candidate || currentPath, 1, line));
      continue;
    }

    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      const rightLine = Number(match?.[2] || 1);
      rendered.push(renderFileLabLink(currentPath, rightLine, line));
      continue;
    }

    rendered.push(escapeHtml(line));
  }

  diffOutputEl.innerHTML = rendered.length ? rendered.join("\n") : "No diff yet.";
}

function renderSideBySideDiff(diffText) {
  const lines = String(diffText || "").split(/\r?\n/);
  const leftRows = [];
  const rightRows = [];
  let leftLine = 0;
  let rightLine = 0;
  let currentPath = "";

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = normalizeDiffPath(match?.[2] || match?.[1] || "");
      const label = renderFileLabLink(currentPath, 1, `FILE ${currentPath || "(unknown)"}`);
      leftRows.push(label);
      rightRows.push(label);
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      const candidate = normalizeDiffPath(line.slice(4).trim());
      if (candidate) {
        currentPath = candidate;
      }
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        leftLine = Number(match[1]) - 1;
        rightLine = Number(match[2]) - 1;
      }
      leftRows.push(renderFileLabLink(currentPath, leftLine + 1, `---- hunk @ ${currentPath || "file"}:${leftLine + 1} ----`));
      rightRows.push(renderFileLabLink(currentPath, rightLine + 1, `---- hunk @ ${currentPath || "file"}:${rightLine + 1} ----`));
      continue;
    }
    if (line.startsWith("index ")) {
      continue;
    }

    if (line.startsWith("+")) {
      rightLine += 1;
      leftRows.push("     ");
      rightRows.push(renderDiffLineWithGutter(currentPath, rightLine, line.slice(1)));
      continue;
    }

    if (line.startsWith("-")) {
      leftLine += 1;
      leftRows.push(renderDiffLineWithGutter(currentPath, leftLine, line.slice(1)));
      rightRows.push("     ");
      continue;
    }

    if (line.startsWith(" ")) {
      leftLine += 1;
      rightLine += 1;
      const text = line.slice(1);
      leftRows.push(renderDiffLineWithGutter(currentPath, leftLine, text));
      rightRows.push(renderDiffLineWithGutter(currentPath, rightLine, text));
      continue;
    }
  }

  diffLeftOutputEl.innerHTML = leftRows.length ? leftRows.join("\n") : "No diff yet.";
  diffRightOutputEl.innerHTML = rightRows.length ? rightRows.join("\n") : "No diff yet.";
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

async function runRefDiff() {
  diffStatusEl.textContent = "Running ref diff...";
  const left = (leftRefInputEl.value || "HEAD~1").trim();
  const right = (rightRefInputEl.value || "HEAD").trim();
  const targetPath = (diffPathInputEl.value || "").trim();

  try {
    const params = new URLSearchParams({ left, right });
    if (targetPath) {
      params.set("path", targetPath);
    }
    const response = await fetch(`/api/files/diff?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Diff failed");
    }
    renderRawDiffOutput(data.diff || "");
    renderSideBySideDiff(data.diff || "");
    diffStatusEl.textContent = `Diff loaded for ${data.left}..${data.right}.`;
  } catch (error) {
    diffStatusEl.textContent = `Error: ${error.message}`;
  }
}

async function runPathDiff() {
  diffStatusEl.textContent = "Running path diff...";
  try {
    const response = await fetch("/api/files/diff/paths", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leftPath: (leftPathInputEl.value || "").trim(),
        rightPath: (rightPathInputEl.value || "").trim()
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Path diff failed");
    }
    renderRawDiffOutput(data.diff || "");
    renderSideBySideDiff(data.diff || "");
    diffStatusEl.textContent = `Path diff loaded: ${data.leftPath} vs ${data.rightPath}.`;
  } catch (error) {
    diffStatusEl.textContent = `Error: ${error.message}`;
  }
}

async function mergeFromSnapshot() {
  const ref = (mergeRefInputEl.value || "").trim();
  const targetPath = (mergePathInputEl.value || "").trim();
  if (!ref || !targetPath) {
    diffStatusEl.textContent = "Provide ref and target path for merge.";
    return;
  }

  const ok = window.confirm(`Apply ${targetPath} from snapshot ${ref}?`);
  if (!ok) {
    return;
  }

  diffStatusEl.textContent = "Applying merge from snapshot...";
  try {
    const response = await fetch("/api/files/merge/from-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref, path: targetPath })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Merge failed");
    }
    diffStatusEl.textContent = `Merged ${data.path} from ${data.ref}.`;
  } catch (error) {
    diffStatusEl.textContent = `Error: ${error.message}`;
  }
}

runRefDiffBtnEl.addEventListener("click", runRefDiff);
runPathDiffBtnEl.addEventListener("click", runPathDiff);
mergeFromSnapshotBtnEl.addEventListener("click", mergeFromSnapshot);

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

initTheme();
