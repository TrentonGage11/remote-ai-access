export function appendMetricSample(history, sample, limit = 180) {
  const next = [...(Array.isArray(history) ? history : []), sample];
  return next.slice(-Math.max(1, Math.min(1440, Number(limit) || 180)));
}

export function calculateCpuPercent(previous, current) {
  if (!previous || !current) return null;
  const idleDelta = Number(current.idle || 0) - Number(previous.idle || 0);
  const totalDelta = Number(current.total || 0) - Number(previous.total || 0);
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, Number(((1 - idleDelta / totalDelta) * 100).toFixed(1))));
}

export function summarizeRuntimeSample(sample, thresholds = {}) {
  const warning = {
    cpuPercent: Number(thresholds.cpuPercent || 85),
    memoryPercent: Number(thresholds.memoryPercent || 85),
    diskPercent: Number(thresholds.diskPercent || 90),
    queueDepth: Number(thresholds.queueDepth || 10)
  };
  const alerts = [];
  if (Number(sample.cpuPercent || 0) >= warning.cpuPercent) alerts.push("CPU usage is high");
  if (Number(sample.memoryPercent || 0) >= warning.memoryPercent) alerts.push("Host memory usage is high");
  if (Number(sample.diskPercent || 0) >= warning.diskPercent) alerts.push("Workspace disk usage is high");
  if (Number(sample.queue?.queued || 0) >= warning.queueDepth) alerts.push("Agent queue depth is high");
  return { status: alerts.length ? "degraded" : "ok", alerts, thresholds: warning };
}