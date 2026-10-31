const $ = (id) => document.getElementById(id);
const changeList = $("changeList");
let statusState = { files: [] };
let activePath = "";
const requestedPaths = [...new Set(new URLSearchParams(window.location.search).getAll("path"))];
let requestedPathsApplied = false;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setMessage(message) { $("gitStatus").textContent = message; }
function selectedPaths() { return [...changeList.querySelectorAll("input:checked")].map((input) => input.value); }
function codeLabel(file) { return file.conflict ? "CONFLICT" : file.untracked ? "NEW" : `${file.staged ? "STAGED" : ""}${file.staged && file.unstaged ? " + " : ""}${file.unstaged ? "WORKING" : ""}`; }

function renderStatus(status) {
  statusState = status;
  $("gitSummary").textContent = `${status.branch || "detached"} · ${status.files.length} changed · ${status.ahead} ahead · ${status.behind} behind`;
  $("branchSelect").innerHTML = status.branches.map((branch) => `<option${branch === status.branch ? " selected" : ""}>${escapeHtml(branch)}</option>`).join("");
  changeList.innerHTML = status.files.length ? status.files.map((file) => `
    <li class="git-change-item${file.conflict ? " is-conflict" : ""}" data-path="${escapeHtml(file.path)}">
      <input type="checkbox" value="${escapeHtml(file.path)}" aria-label="Select ${escapeHtml(file.path)}" />
      <button type="button" class="git-file-select"><strong>${escapeHtml(file.path)}</strong><span>${escapeHtml(codeLabel(file))} · ${escapeHtml(file.code)}</span></button>
    </li>`).join("") : '<li class="git-empty">Working tree clean.</li>';
  changeList.querySelectorAll(".git-file-select").forEach((button) => button.addEventListener("click", () => selectFile(button.closest("li").dataset.path)));
  if (activePath && !status.files.some((file) => file.path === activePath)) activePath = "";
  if (!requestedPathsApplied && requestedPaths.length > 0) {
    requestedPathsApplied = true;
    for (const input of changeList.querySelectorAll("input")) input.checked = requestedPaths.includes(input.value);
    const firstPath = requestedPaths.find((path) => status.files.some((file) => file.path === path));
    if (firstPath) queueMicrotask(() => selectFile(firstPath).catch((error) => setMessage(`Error: ${error.message}`)));
  }
}

async function refresh() {
  setMessage("Refreshing...");
  const status = await api("/api/files/git/status");
  renderStatus(status);
  setMessage(status.clean ? "Working tree clean." : `${status.files.length} change(s). Select a file to review.`);
}

function renderSideBySide(text) {
  const left = [], right = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const safe = escapeHtml(line.slice(1));
    if (line.startsWith("+") && !line.startsWith("+++")) { left.push(""); right.push(`+ ${safe}`); }
    else if (line.startsWith("-") && !line.startsWith("---")) { left.push(`- ${safe}`); right.push(""); }
    else { const full = escapeHtml(line); left.push(full); right.push(full); }
  }
  $("leftDiff").innerHTML = left.join("\n") || "No diff.";
  $("rightDiff").innerHTML = right.join("\n") || "No diff.";
}

async function loadDiff(staged = false) {
  if (!activePath) return;
  const data = await api(`/api/files/git/change-diff?path=${encodeURIComponent(activePath)}&staged=${staged}`);
  $("rawDiff").textContent = data.diff || "No textual diff for this state.";
  renderSideBySide(data.diff);
}

async function selectFile(path) {
  activePath = path;
  const file = statusState.files.find((item) => item.path === path);
  $("diffTitle").textContent = path;
  $("openFileLink").hidden = false;
  $("openFileLink").href = `filelab.html?path=${encodeURIComponent(path)}`;
  $("conflictActions").hidden = !file?.conflict;
  await loadDiff(Boolean(file?.staged && !file?.unstaged));
}

async function mutate(path, body) {
  setMessage("Applying Git operation...");
  const data = await api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  renderStatus(data.status);
  setMessage("Git operation completed.");
}

$("refreshBtn").addEventListener("click", () => refresh().catch((error) => setMessage(`Error: ${error.message}`)));
$("stageBtn").addEventListener("click", () => mutate("/api/files/git/stage", { paths: selectedPaths() }).catch((error) => setMessage(`Error: ${error.message}`)));
$("unstageBtn").addEventListener("click", () => mutate("/api/files/git/unstage", { paths: selectedPaths() }).catch((error) => setMessage(`Error: ${error.message}`)));
$("commitBtn").addEventListener("click", () => mutate("/api/files/git/commit", { message: $("commitMessageInput").value }).then(() => { $("commitMessageInput").value = ""; }).catch((error) => setMessage(`Error: ${error.message}`)));
$("switchBranchBtn").addEventListener("click", () => mutate("/api/files/git/branch", { branch: $("branchSelect").value, create: false }).catch((error) => setMessage(`Error: ${error.message}`)));
$("createBranchBtn").addEventListener("click", () => mutate("/api/files/git/branch", { branch: $("newBranchInput").value, create: true }).catch((error) => setMessage(`Error: ${error.message}`)));
$("workingDiffBtn").addEventListener("click", () => loadDiff(false).catch((error) => setMessage(`Error: ${error.message}`)));
$("stagedDiffBtn").addEventListener("click", () => loadDiff(true).catch((error) => setMessage(`Error: ${error.message}`)));
$("conflictActions").addEventListener("click", (event) => {
  const strategy = event.target.closest("button")?.dataset.strategy;
  if (strategy) mutate("/api/files/git/conflict", { path: activePath, strategy }).catch((error) => setMessage(`Error: ${error.message}`));
});
$("themeToggle").addEventListener("click", () => { const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = next; localStorage.setItem("remote-ai-access-theme", next); });
document.documentElement.dataset.theme = localStorage.getItem("remote-ai-access-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
refresh().catch((error) => setMessage(`Error: ${error.message}`));