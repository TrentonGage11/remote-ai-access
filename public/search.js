const THEME_STORAGE_KEY = "remote-ai-access-theme";

const themeToggleEl = document.getElementById("themeToggle");
const searchQueryInputEl = document.getElementById("searchQueryInput");
const searchModeSelectEl = document.getElementById("searchModeSelect");
const searchPathInputEl = document.getElementById("searchPathInput");
const searchLimitInputEl = document.getElementById("searchLimitInput");
const runSearchBtnEl = document.getElementById("runSearchBtn");
const searchStatusEl = document.getElementById("searchStatus");
const searchResultsListEl = document.getElementById("searchResultsList");
const searchPresetNameInputEl = document.getElementById("searchPresetNameInput");
const savePresetBtnEl = document.getElementById("savePresetBtn");
const searchPresetSelectEl = document.getElementById("searchPresetSelect");
const applyPresetBtnEl = document.getElementById("applyPresetBtn");
const deletePresetBtnEl = document.getElementById("deletePresetBtn");
const searchRecentSelectEl = document.getElementById("searchRecentSelect");
const applyRecentBtnEl = document.getElementById("applyRecentBtn");
const clearRecentBtnEl = document.getElementById("clearRecentBtn");

const SEARCH_PRESETS_KEY = "remote-ai-access-search-presets-v1";
const SEARCH_RECENT_KEY = "remote-ai-access-search-recent-v1";

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

function renderResults(items) {
  searchResultsListEl.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.style.cursor = "default";
    li.textContent = "No matches found.";
    searchResultsListEl.appendChild(li);
    return;
  }

  for (const result of items) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.style.cursor = "default";

    const heading = document.createElement("div");
    const path = document.createElement("strong");
    path.textContent = String(result.path || "");
    heading.appendChild(path);

    const meta = document.createElement("div");
    meta.style.marginTop = "4px";
    meta.textContent = `score=${result.score} | exact=${result.exactCount} | semantic=${result.semanticScore}`;

    const snippet = document.createElement("div");
    snippet.style.marginTop = "6px";
    snippet.textContent = result.snippet || "";

    li.appendChild(heading);
    li.appendChild(meta);
    li.appendChild(snippet);
    searchResultsListEl.appendChild(li);
  }
}

function getPresets() {
  try {
    const raw = localStorage.getItem(SEARCH_PRESETS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePresets(list) {
  localStorage.setItem(SEARCH_PRESETS_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function renderPresets() {
  const presets = getPresets();
  searchPresetSelectEl.innerHTML = '<option value="">Load preset...</option>';
  for (const item of presets) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.name;
    searchPresetSelectEl.appendChild(opt);
  }
}

function getRecentQueries() {
  try {
    const raw = localStorage.getItem(SEARCH_RECENT_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecentQueries(list) {
  localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(Array.isArray(list) ? list : []));
}

function pushRecentQuery(query) {
  const value = String(query || "").trim();
  if (!value) {
    return;
  }
  const next = [value, ...getRecentQueries().filter((item) => item !== value)].slice(0, 20);
  saveRecentQueries(next);
  renderRecentQueries();
}

function renderRecentQueries() {
  const recent = getRecentQueries();
  searchRecentSelectEl.innerHTML = '<option value="">Recent queries...</option>';
  for (const item of recent) {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    searchRecentSelectEl.appendChild(opt);
  }
}

async function runSearch() {
  const query = (searchQueryInputEl.value || "").trim();
  if (!query) {
    searchStatusEl.textContent = "Enter a query first.";
    return;
  }

  searchStatusEl.textContent = "Searching...";
  runSearchBtnEl.disabled = true;
  try {
    const params = new URLSearchParams({
      q: query,
      mode: searchModeSelectEl.value || "hybrid",
      limit: String(Number(searchLimitInputEl.value || 20))
    });
    const targetPath = (searchPathInputEl.value || "").trim();
    if (targetPath) {
      params.set("path", targetPath);
    }

    const response = await fetch(`/api/files/search?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Search failed");
    }

    renderResults(data.results || []);
    pushRecentQuery(query);
    searchStatusEl.textContent = `Scanned ${data.filesScanned} files. Found ${data.resultCount} matches.`;
  } catch (error) {
    searchStatusEl.textContent = `Error: ${error.message}`;
  } finally {
    runSearchBtnEl.disabled = false;
  }
}

function applyPreset(id) {
  const presets = getPresets();
  const match = presets.find((item) => item.id === id);
  if (!match) {
    return false;
  }
  searchQueryInputEl.value = match.query || "";
  searchModeSelectEl.value = match.mode || "hybrid";
  searchPathInputEl.value = match.path || "";
  searchLimitInputEl.value = String(Number(match.limit || 20));
  return true;
}

runSearchBtnEl.addEventListener("click", runSearch);
savePresetBtnEl.addEventListener("click", () => {
  const name = String(searchPresetNameInputEl.value || "").trim();
  if (!name) {
    searchStatusEl.textContent = "Enter a preset name.";
    return;
  }
  const preset = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    query: String(searchQueryInputEl.value || ""),
    mode: searchModeSelectEl.value || "hybrid",
    path: String(searchPathInputEl.value || ""),
    limit: Number(searchLimitInputEl.value || 20)
  };
  const next = [preset, ...getPresets()].slice(0, 50);
  savePresets(next);
  renderPresets();
  searchPresetNameInputEl.value = "";
  searchStatusEl.textContent = "Preset saved.";
});

applyPresetBtnEl.addEventListener("click", () => {
  const ok = applyPreset(searchPresetSelectEl.value || "");
  searchStatusEl.textContent = ok ? "Preset applied." : "Select a preset first.";
});

deletePresetBtnEl.addEventListener("click", () => {
  const selected = searchPresetSelectEl.value || "";
  if (!selected) {
    searchStatusEl.textContent = "Select a preset to delete.";
    return;
  }
  const next = getPresets().filter((item) => item.id !== selected);
  savePresets(next);
  renderPresets();
  searchStatusEl.textContent = "Preset deleted.";
});

applyRecentBtnEl.addEventListener("click", () => {
  const value = String(searchRecentSelectEl.value || "").trim();
  if (!value) {
    searchStatusEl.textContent = "Select a recent query first.";
    return;
  }
  searchQueryInputEl.value = value;
  searchStatusEl.textContent = "Recent query applied.";
});

clearRecentBtnEl.addEventListener("click", () => {
  saveRecentQueries([]);
  renderRecentQueries();
  searchStatusEl.textContent = "Recent queries cleared.";
});

searchQueryInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    runSearch();
  }
});

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

initTheme();
renderPresets();
renderRecentQueries();
