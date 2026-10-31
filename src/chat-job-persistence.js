import path from "node:path";
import { promises as fsp } from "node:fs";

const ACTIVE_STATUSES = new Set(["starting", "checkpointing", "running"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function jsonClone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function serializeChatJobState(jobs, pausedWorkspaceCodes = new Set()) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    pausedWorkspaceCodes: [...pausedWorkspaceCodes].map(String),
    jobs: [...(jobs || [])].map((job) => ({
      id: String(job.id || ""),
      traceId: String(job.traceId || ""),
      status: String(job.status || "queued"),
      priority: String(job.priority || "normal"),
      provider: String(job.provider || ""),
      agentMode: Boolean(job.agentMode),
      toolProfile: String(job.toolProfile || "full"),
      autoCheckpoint: Boolean(job.autoCheckpoint),
      checkpoint: jsonClone(job.checkpoint, null),
      workspaceCode: String(job.workspaceCode || ""),
      createdAt: String(job.createdAt || ""),
      updatedAt: String(job.updatedAt || ""),
      cancelRequested: Boolean(job.cancelRequested),
      cancelledAt: job.cancelledAt || null,
      result: jsonClone(job.result, null),
      error: jsonClone(job.error, null),
      recovery: jsonClone(job.recovery, null),
      events: jsonClone(job.events, []),
      scheduleId: job.scheduleId ? String(job.scheduleId) : null,
      requestBody: jsonClone(job.requestBody, null)
    }))
  };
}

export function restoreChatJobState(data, now = new Date()) {
  const jobs = [];
  for (const stored of Array.isArray(data?.jobs) ? data.jobs : []) {
    if (!stored?.id || !stored?.workspaceCode) continue;
    const interrupted = ACTIVE_STATUSES.has(stored.status);
    const status = interrupted ? "failed" : String(stored.status || "queued");
    const events = Array.isArray(stored.events) ? stored.events : [];
    if (interrupted) {
      events.push({
        id: `evt-restart-${now.getTime()}-${stored.id}`,
        jobId: stored.id,
        traceId: stored.traceId || "",
        type: "interrupted-by-restart",
        timestamp: now.toISOString(),
        payload: {}
      });
    }
    jobs.push({
      ...stored,
      status,
      updatedAt: interrupted ? now.toISOString() : stored.updatedAt,
      cancelRequested: status === "cancelled" ? Boolean(stored.cancelRequested) : false,
      error: interrupted
        ? { message: "Job was interrupted by a server restart. It was not replayed because completed tool actions may not be safe to repeat.", status: 500, traceId: stored.traceId || "" }
        : stored.error || null,
      events,
      listeners: new Set(),
      abortController: null,
      execution: null
    });
  }
  return {
    jobs,
    pausedWorkspaceCodes: new Set(Array.isArray(data?.pausedWorkspaceCodes) ? data.pausedWorkspaceCodes.map(String) : [])
  };
}

export async function writeChatJobState(filePath, state) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temporaryPath, filePath);
}

export async function readChatJobState(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

export function isTerminalChatJobStatus(status) {
  return TERMINAL_STATUSES.has(String(status || ""));
}