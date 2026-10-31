export const CHAT_JOB_PRIORITIES = Object.freeze({
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
});

export function normalizeChatJobPriority(value) {
  const priority = String(value || "normal").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(CHAT_JOB_PRIORITIES, priority) ? priority : "normal";
}

export function compareQueuedChatJobs(left, right) {
  const priorityDelta = CHAT_JOB_PRIORITIES[normalizeChatJobPriority(right?.priority)]
    - CHAT_JOB_PRIORITIES[normalizeChatJobPriority(left?.priority)];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const leftCreatedAt = Number(new Date(left?.createdAt || 0).getTime() || 0);
  const rightCreatedAt = Number(new Date(right?.createdAt || 0).getTime() || 0);
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

export function orderedQueuedChatJobs(jobs, pausedWorkspaceCodes = new Set()) {
  return [...(jobs || [])]
    .filter((job) => job?.status === "queued" && !pausedWorkspaceCodes.has(job.workspaceCode))
    .sort(compareQueuedChatJobs);
}

export function selectDispatchableChatJobs(jobs, options = {}) {
  const allJobs = [...(jobs || [])];
  const globalSlots = Math.max(0, Number(options.globalSlots || 0));
  const defaultWorkspaceLimit = Math.max(1, Number(options.defaultWorkspaceLimit || globalSlots || 1));
  const workspaceLimits = options.workspaceLimits instanceof Map ? options.workspaceLimits : new Map();
  const activeByWorkspace = new Map();
  for (const job of allJobs) {
    if (!["starting", "checkpointing", "running"].includes(job?.status)) continue;
    const workspaceCode = String(job.workspaceCode || "");
    activeByWorkspace.set(workspaceCode, (activeByWorkspace.get(workspaceCode) || 0) + 1);
  }

  const selected = [];
  for (const job of orderedQueuedChatJobs(allJobs, options.pausedWorkspaceCodes)) {
    if (selected.length >= globalSlots) break;
    const workspaceCode = String(job.workspaceCode || "");
    const workspaceLimit = Math.max(1, Number(workspaceLimits.get(workspaceCode) || defaultWorkspaceLimit));
    const activeCount = activeByWorkspace.get(workspaceCode) || 0;
    if (activeCount >= workspaceLimit) continue;
    selected.push(job);
    activeByWorkspace.set(workspaceCode, activeCount + 1);
  }
  return selected;
}
