export function normalizeTokenUsage(usage = {}) {
  const inputTokens = Math.max(0, Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokenCount ?? 0) || 0);
  const outputTokens = Math.max(0, Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokenCount ?? 0) || 0);
  const totalTokens = Math.max(inputTokens + outputTokens, Number(usage.total_tokens ?? usage.totalTokenCount ?? 0) || 0);
  return { inputTokens, outputTokens, totalTokens };
}

export function addTokenUsage(left, right) {
  const a = normalizeTokenUsage(left), b = normalizeTokenUsage(right);
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, totalTokens: a.totalTokens + b.totalTokens };
}

export function estimateUsageCost(provider, model, usage, pricing = {}) {
  const rate = pricing?.[`${provider}/${model}`] || pricing?.[model];
  if (!rate) return { estimatedCostUsd: null, priced: false };
  const tokens = normalizeTokenUsage(usage);
  const estimatedCostUsd = tokens.inputTokens * Number(rate.inputPerMillion || 0) / 1_000_000
    + tokens.outputTokens * Number(rate.outputPerMillion || 0) / 1_000_000;
  return { estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)), priced: true };
}

export function aggregateUsage(entries, { workspaceCode = "", traceId = "", from = 0 } = {}) {
  const rows = (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (workspaceCode && entry.workspaceCode !== workspaceCode) return false;
    if (traceId && entry.traceId !== traceId) return false;
    return !from || Date.parse(entry.timestamp) >= from;
  });
  const totals = rows.reduce((sum, entry) => ({
    requests: sum.requests + 1,
    failures: sum.failures + (entry.ok ? 0 : 1),
    inputTokens: sum.inputTokens + Number(entry.inputTokens || 0),
    outputTokens: sum.outputTokens + Number(entry.outputTokens || 0),
    totalTokens: sum.totalTokens + Number(entry.totalTokens || 0),
    estimatedCostUsd: sum.estimatedCostUsd + Number(entry.estimatedCostUsd || 0),
    unpricedRequests: sum.unpricedRequests + (entry.priced ? 0 : 1),
    latencyMs: sum.latencyMs + Number(entry.latencyMs || 0)
  }), { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, unpricedRequests: 0, latencyMs: 0 });
  totals.estimatedCostUsd = Number(totals.estimatedCostUsd.toFixed(6));
  totals.averageLatencyMs = totals.requests ? Math.round(totals.latencyMs / totals.requests) : 0;
  return { entries: rows, totals };
}