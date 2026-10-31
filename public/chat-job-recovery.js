export function getJobRecoveryMessage(job) {
  const reply = typeof job?.result?.reply === "string" ? job.result.reply.trim() : "";
  if (job?.status !== "completed" || !reply) return null;
  return {
    jobId: String(job.id || ""),
    traceId: String(job.result?.traceId || job.traceId || ""),
    prompt: String(job.recovery?.prompt || "").trim(),
    reply,
    provider: String(job.result?.provider || job.provider || ""),
    model: String(job.result?.model || job.recovery?.model || ""),
    executedTools: Array.isArray(job.result?.executedTools) ? job.result.executedTools : [],
    contextCompaction: job.result?.contextCompaction || null,
    checkpoint: job.result?.checkpoint || null,
    contextMutations: Array.isArray(job.result?.contextMutations) ? job.result.contextMutations : []
  };
}

export function hasRecoveredJob(chat, jobId) {
  const id = String(jobId || "");
  return Boolean(id) && Array.isArray(chat?.messages) && chat.messages.some((message) => String(message?.jobId || "") === id);
}

export function disclosureKey(kind, jobId, section) {
  return `${String(kind || "job")}:${String(jobId || "unknown")}:${String(section || "output")}`;
}