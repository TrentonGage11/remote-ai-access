const categorySelectEl = document.getElementById("activityCategorySelect");
const queryInputEl = document.getElementById("activityQueryInput");
const traceInputEl = document.getElementById("activityTraceInput");
const fromInputEl = document.getElementById("activityFromInput");
const toInputEl = document.getElementById("activityToInput");
const limitSelectEl = document.getElementById("activityLimitSelect");
const liveToggleEl = document.getElementById("activityLiveToggle");
const refreshBtnEl = document.getElementById("refreshActivityBtn");
const clearBtnEl = document.getElementById("clearActivityFiltersBtn");
const summaryEl = document.getElementById("activitySummary");
const countsEl = document.getElementById("activityCategoryCounts");
const updatedAtEl = document.getElementById("activityUpdatedAt");
const listEl = document.getElementById("activityList");
const emptyEl = document.getElementById("activityEmpty");

const categoryLabels = {
  agent: "Agents",
  subagent: "Subagents",
  tool: "Tools",
  git: "Git",
  file: "Files",
  share: "Shares",
  recipe: "Recipes",
  failure: "Failures",
  workspace: "Other"
};
let refreshTimer = null;
let requestSequence = 0;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isoFromLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function relativeTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown time";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function eventPath(event) {
  return String(event?.details?.path || event?.details?.outputPath || "").trim();
}

function eventLinks(event) {
  const links = [];
  if (event.traceId) {
    links.push(`<a href="audit.html?traceId=${encodeURIComponent(event.traceId)}&limit=500">Audit trace</a>`);
  }
  const path = eventPath(event);
  if (path) {
    links.push(`<a href="filelab.html?path=${encodeURIComponent(path)}">Open file</a>`);
  }
  return links.length ? `<div class="activity-links">${links.join("")}</div>` : "";
}

function renderEvents(events) {
  listEl.innerHTML = "";
  emptyEl.hidden = events.length > 0;
  let previousDay = "";
  for (const event of events) {
    const date = new Date(event.timestamp);
    const day = Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Unknown date";
    if (day !== previousDay) {
      const marker = document.createElement("li");
      marker.className = "activity-day";
      marker.textContent = day;
      listEl.appendChild(marker);
      previousDay = day;
    }

    const item = document.createElement("li");
    item.className = `activity-item activity-${event.category}`;
    const details = event.details && Object.keys(event.details).length
      ? `<details><summary>Evidence</summary><pre class="doc-json">${escapeHtml(JSON.stringify(event.details, null, 2))}</pre></details>`
      : "";
    item.innerHTML = `
      <span class="activity-node" aria-hidden="true"></span>
      <article>
        <header>
          <span class="activity-category">${escapeHtml(categoryLabels[event.category] || event.category)}</span>
          <strong>${escapeHtml(event.title)}</strong>
          <time datetime="${escapeHtml(event.timestamp)}" title="${escapeHtml(date.toLocaleString())}">${escapeHtml(relativeTime(event.timestamp))}</time>
        </header>
        <div class="activity-meta">
          ${event.entityId ? `<code>${escapeHtml(event.entityId)}</code>` : ""}
          ${event.traceId ? `<code>${escapeHtml(event.traceId)}</code>` : ""}
          <span>${escapeHtml(event.status)}</span>
        </div>
        ${eventLinks(event)}
        ${details}
      </article>`;
    listEl.appendChild(item);
  }
}

function renderCounts(categories) {
  countsEl.innerHTML = Object.entries(categories || {})
    .sort((left, right) => right[1] - left[1])
    .map(([category, count]) => `<span class="activity-count activity-${escapeHtml(category)}"><strong>${count}</strong> ${escapeHtml(categoryLabels[category] || category)}</span>`)
    .join("");
}

async function loadActivity() {
  const sequence = ++requestSequence;
  const params = new URLSearchParams({ limit: limitSelectEl.value });
  if (categorySelectEl.value) params.set("category", categorySelectEl.value);
  if (queryInputEl.value.trim()) params.set("query", queryInputEl.value.trim());
  if (traceInputEl.value.trim()) params.set("traceId", traceInputEl.value.trim());
  const from = isoFromLocal(fromInputEl.value);
  const to = isoFromLocal(toInputEl.value);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  summaryEl.textContent = "Loading activity...";
  try {
    const response = await fetch(`/api/activity?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Failed to load activity");
    if (sequence !== requestSequence) return;
    summaryEl.textContent = `${data.count} recent events in workspace ${data.workspaceCode}`;
    updatedAtEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    renderCounts(data.categories);
    renderEvents(Array.isArray(data.events) ? data.events : []);
  } catch (error) {
    if (sequence !== requestSequence) return;
    summaryEl.textContent = `Error: ${error.message}`;
    renderCounts({});
    renderEvents([]);
  }
}

function scheduleLiveRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = liveToggleEl.checked ? setInterval(() => {
    if (!document.hidden && !listEl.querySelector("details[open]")) loadActivity();
  }, 10000) : null;
}

let filterTimer = null;
for (const input of [categorySelectEl, fromInputEl, toInputEl, limitSelectEl]) {
  input.addEventListener("change", loadActivity);
}
for (const input of [queryInputEl, traceInputEl]) {
  input.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadActivity, 300);
  });
}
refreshBtnEl.addEventListener("click", loadActivity);
liveToggleEl.addEventListener("change", scheduleLiveRefresh);
clearBtnEl.addEventListener("click", () => {
  categorySelectEl.value = "";
  queryInputEl.value = "";
  traceInputEl.value = "";
  fromInputEl.value = "";
  toInputEl.value = "";
  limitSelectEl.value = "250";
  loadActivity();
});

loadActivity();
scheduleLiveRefresh();