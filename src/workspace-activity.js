const FAILURE_PATTERN = /error|fail|cancel|interrupt|denied|reject/i;

function categoryForAudit(entry) {
  const operation = String(entry?.operation || "activity").toLowerCase();
  if (FAILURE_PATTERN.test(operation)) return "failure";
  if (operation.includes("agent-recipe")) return "recipe";
  if (operation.includes("agent-tool")) return "tool";
  if (operation.includes("subagent")) return "subagent";
  if (operation.includes("share")) return "share";
  if (operation.includes("git") || operation.includes("snapshot")) return "git";
  if (operation.includes("upload") || operation.includes("file")) return "file";
  return "workspace";
}

function categoryForEvent(type, source) {
  if (FAILURE_PATTERN.test(type)) return "failure";
  if (/tool-start|tool-end|tool-call/i.test(type)) return "tool";
  return source === "subagent" ? "subagent" : "agent";
}

function addEvent(target, event) {
  const timestampMs = Date.parse(event.timestamp);
  if (!Number.isFinite(timestampMs)) return;
  target.push({ ...event, timestampMs });
}

export function buildWorkspaceActivityTimeline({ auditEntries = [], chatJobs = [], subagentJobs = [] } = {}, filters = {}) {
  const events = [];

  for (const [index, entry] of auditEntries.entries()) {
    const operation = String(entry?.operation || "activity");
    const toolName = String(entry?.details?.name || "").trim();
    addEvent(events, {
      id: `audit:${entry?.timestamp || index}:${index}`,
      source: "audit",
      category: categoryForAudit(entry),
      type: operation,
      title: toolName ? `${toolName} · ${operation}` : operation,
      timestamp: String(entry?.timestamp || ""),
      traceId: String(entry?.traceId || ""),
      entityId: "",
      status: FAILURE_PATTERN.test(operation) ? "error" : "ok",
      details: entry?.details && typeof entry.details === "object" ? entry.details : {}
    });
  }

  for (const job of chatJobs) {
    for (const [index, event] of (Array.isArray(job?.events) ? job.events : []).entries()) {
      const type = String(event?.type || "event");
      addEvent(events, {
        id: String(event?.id || `job:${job?.id || "unknown"}:${index}`),
        source: "agent",
        category: categoryForEvent(type, "agent"),
        type,
        title: `Agent run · ${type}`,
        timestamp: String(event?.timestamp || ""),
        traceId: String(event?.traceId || job?.traceId || ""),
        entityId: String(job?.id || ""),
        status: FAILURE_PATTERN.test(type) ? "error" : String(job?.status || "ok"),
        details: event?.payload && typeof event.payload === "object" ? event.payload : {}
      });
    }
  }

  for (const job of subagentJobs) {
    for (const [index, event] of (Array.isArray(job?.events) ? job.events : []).entries()) {
      const type = String(event?.type || "event");
      addEvent(events, {
        id: `subagent:${job?.id || "unknown"}:${event?.timestamp || index}:${index}`,
        source: "subagent",
        category: categoryForEvent(type, "subagent"),
        type,
        title: `${String(job?.role || "Subagent")} child · ${type}`,
        timestamp: String(event?.timestamp || ""),
        traceId: String(job?.parentId || ""),
        entityId: String(job?.id || ""),
        status: FAILURE_PATTERN.test(type) ? "error" : String(job?.status || "ok"),
        details: event?.payload && typeof event.payload === "object" ? event.payload : {}
      });
    }
  }

  const category = String(filters.category || "").trim().toLowerCase();
  const traceId = String(filters.traceId || "").trim().toLowerCase();
  const query = String(filters.query || "").trim().toLowerCase();
  const fromMs = filters.from ? Date.parse(filters.from) : NaN;
  const toMs = filters.to ? Date.parse(filters.to) : NaN;
  const limit = Math.max(1, Math.min(1000, Number(filters.limit || 250)));

  return events
    .filter((event) => !category || event.category === category)
    .filter((event) => !traceId || event.traceId.toLowerCase().includes(traceId))
    .filter((event) => !Number.isFinite(fromMs) || event.timestampMs >= fromMs)
    .filter((event) => !Number.isFinite(toMs) || event.timestampMs <= toMs)
    .filter((event) => !query || JSON.stringify(event).toLowerCase().includes(query))
    .sort((left, right) => right.timestampMs - left.timestampMs || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map(({ timestampMs, ...event }) => event);
}