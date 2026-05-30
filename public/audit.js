const refreshAuditBtnEl = document.getElementById("refreshAuditBtn");
const loadAuditBtnEl = document.getElementById("loadAuditBtn");
const limitInputEl = document.getElementById("limitInput");
const operationFilterSelectEl = document.getElementById("operationFilterSelect");
const toolNameInputEl = document.getElementById("toolNameInput");
const traceIdInputEl = document.getElementById("traceIdInput");
const onlyErrorsToggleEl = document.getElementById("onlyErrorsToggle");
const auditListEl = document.getElementById("auditList");
const auditDetailEl = document.getElementById("auditDetail");
const auditJsonEl = document.getElementById("auditJson");
const detailSearchInputEl = document.getElementById("detailSearchInput");
const copyArgsBtnEl = document.getElementById("copyArgsBtn");
const copyOutputBtnEl = document.getElementById("copyOutputBtn");
const exportJsonBtnEl = document.getElementById("exportJsonBtn");
const exportCsvBtnEl = document.getElementById("exportCsvBtn");
const loadMoreAuditBtnEl = document.getElementById("loadMoreAuditBtn");

let currentEntries = [];
let selectedEntry = null;
let paging = { hasMore: false, nextBefore: null };

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(timestamp) {
  const t = new Date(timestamp).getTime();
  if (!Number.isFinite(t)) {
    return "unknown";
  }
  const diff = Math.max(0, Date.now() - t);
  if (diff < 1000) {
    return "just now";
  }
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function renderSelectedEntry(entry) {
  if (!auditDetailEl) {
    return;
  }
  selectedEntry = entry || null;
  if (!entry) {
    auditDetailEl.textContent = "Select a record to inspect args/output.";
    return;
  }

  const search = String(detailSearchInputEl?.value || "").trim().toLowerCase();
  const formatted = JSON.stringify(entry, null, 2);
  if (!search) {
    auditDetailEl.textContent = formatted;
    return;
  }

  const lower = formatted.toLowerCase();
  const at = lower.indexOf(search);
  if (at < 0) {
    auditDetailEl.textContent = `${formatted}\n\n[search: '${search}' not found]`;
    return;
  }

  const start = Math.max(0, at - 220);
  const end = Math.min(formatted.length, at + search.length + 220);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < formatted.length ? "..." : "";
  const excerpt = formatted.slice(start, end);
  auditDetailEl.textContent = `${formatted}\n\n[search excerpt]\n${prefix}${excerpt}${suffix}`;
}

function renderEntryList(entries) {
  if (!auditListEl) {
    return;
  }

  auditListEl.innerHTML = "";
  if (!Array.isArray(entries) || entries.length === 0) {
    const li = document.createElement("li");
    li.className = "tool-run-item";
    li.textContent = "No records for this filter.";
    auditListEl.appendChild(li);
    renderSelectedEntry(null);
    return;
  }

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const operation = String(entry?.operation || "unknown");
    const toolName = String(entry?.details?.name || "").trim();
    const summaryName = toolName || operation;

    const li = document.createElement("li");
    li.className = "tool-run-item";
    li.style.cursor = "pointer";
    li.innerHTML = `<span class="tool-chip">${escapeHtml(summaryName)}</span> <span class="tool-run-time">${escapeHtml(timeAgo(entry?.timestamp))}</span>`;
    li.addEventListener("click", () => {
      renderSelectedEntry(entry);
    });
    auditListEl.appendChild(li);

    if (index === 0) {
      renderSelectedEntry(entry);
    }
  }
}

async function loadAudit({ append = false } = {}) {
  const limit = Math.max(1, Math.min(1000, Number(limitInputEl.value || 200)));
  const operation = String(operationFilterSelectEl?.value || "").trim();
  const toolName = String(toolNameInputEl?.value || "").trim();
  const traceId = String(traceIdInputEl?.value || "").trim();
  const onlyErrors = Boolean(onlyErrorsToggleEl?.checked);

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (append && paging?.nextBefore) {
    params.set("before", String(paging.nextBefore));
  }
  if (operation) {
    params.set("operation", operation);
  }
  if (toolName) {
    params.set("tool", toolName);
  }
  if (traceId) {
    params.set("traceId", traceId);
  }
  if (onlyErrors) {
    params.set("onlyErrors", "true");
  }

  try {
    const response = await fetch(`/api/files/audit?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load audit log");
    }
    const incoming = Array.isArray(data?.entries) ? data.entries : [];
    currentEntries = append ? [...currentEntries, ...incoming] : incoming;
    paging = {
      hasMore: Boolean(data?.paging?.hasMore),
      nextBefore: data?.paging?.nextBefore || null
    };
    if (loadMoreAuditBtnEl) {
      loadMoreAuditBtnEl.disabled = !paging.hasMore;
      loadMoreAuditBtnEl.textContent = paging.hasMore ? "Load More" : "No More Records";
    }
    renderEntryList(currentEntries);
    auditJsonEl.textContent = JSON.stringify(currentEntries, null, 2);
  } catch (error) {
    currentEntries = [];
    selectedEntry = null;
    paging = { hasMore: false, nextBefore: null };
    renderEntryList([]);
    auditJsonEl.textContent = `Error: ${error.message}`;
  }
}

function applyFiltersFromLocation() {
  const params = new URLSearchParams(window.location.search || "");
  const limit = Number(params.get("limit") || "");
  if (Number.isFinite(limit) && limit > 0 && limitInputEl) {
    limitInputEl.value = String(Math.max(1, Math.min(1000, Math.floor(limit))));
  }

  const operation = String(params.get("operation") || "").trim();
  if (operation && operationFilterSelectEl) {
    operationFilterSelectEl.value = operation;
  }

  const tool = String(params.get("tool") || "").trim();
  if (tool && toolNameInputEl) {
    toolNameInputEl.value = tool;
  }

  const traceId = String(params.get("traceId") || params.get("trace") || "").trim();
  if (traceId && traceIdInputEl) {
    traceIdInputEl.value = traceId;
  }

  const onlyErrors = String(params.get("onlyErrors") || "").trim().toLowerCase();
  if (onlyErrorsToggleEl && (onlyErrors === "true" || onlyErrors === "1")) {
    onlyErrorsToggleEl.checked = true;
  }
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsvValue(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function exportEntriesAsCsv(entries) {
  const rows = [
    ["timestamp", "operation", "traceId", "toolName", "ok", "durationMs", "error"].join(",")
  ];
  for (const entry of entries) {
    const row = [
      toCsvValue(entry?.timestamp || ""),
      toCsvValue(entry?.operation || ""),
      toCsvValue(entry?.traceId || ""),
      toCsvValue(entry?.details?.name || ""),
      toCsvValue(entry?.details?.ok),
      toCsvValue(entry?.details?.durationMs),
      toCsvValue(entry?.details?.error || "")
    ];
    rows.push(row.join(","));
  }
  return rows.join("\n");
}

refreshAuditBtnEl.addEventListener("click", () => loadAudit({ append: false }));
loadAuditBtnEl.addEventListener("click", () => loadAudit({ append: false }));
operationFilterSelectEl?.addEventListener("change", () => loadAudit({ append: false }));
toolNameInputEl?.addEventListener("change", () => loadAudit({ append: false }));
traceIdInputEl?.addEventListener("change", () => loadAudit({ append: false }));
onlyErrorsToggleEl?.addEventListener("change", () => loadAudit({ append: false }));
detailSearchInputEl?.addEventListener("input", () => renderSelectedEntry(selectedEntry));
loadMoreAuditBtnEl?.addEventListener("click", () => loadAudit({ append: true }));

copyArgsBtnEl?.addEventListener("click", async () => {
  const text = JSON.stringify(selectedEntry?.details?.args || null, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Ignore clipboard errors.
  }
});

copyOutputBtnEl?.addEventListener("click", async () => {
  const text = JSON.stringify(selectedEntry?.details?.output || null, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Ignore clipboard errors.
  }
});

exportJsonBtnEl?.addEventListener("click", () => {
  downloadTextFile(`audit-${Date.now()}.json`, JSON.stringify(currentEntries, null, 2));
});

exportCsvBtnEl?.addEventListener("click", () => {
  downloadTextFile(`audit-${Date.now()}.csv`, exportEntriesAsCsv(currentEntries));
});

applyFiltersFromLocation();
loadAudit({ append: false });
