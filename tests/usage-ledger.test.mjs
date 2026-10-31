import test from "node:test";
import assert from "node:assert/strict";
import { addTokenUsage, aggregateUsage, estimateUsageCost, normalizeTokenUsage } from "../src/usage-ledger.js";

test("normalizes and combines provider usage formats", () => {
  assert.deepEqual(normalizeTokenUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }), { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
  assert.deepEqual(addTokenUsage({ input_tokens: 2, output_tokens: 3 }, { prompt_tokens: 5, completion_tokens: 7 }), { inputTokens: 7, outputTokens: 10, totalTokens: 17 });
});

test("prices only configured models and aggregates filters", () => {
  assert.deepEqual(estimateUsageCost("openai", "known", { input_tokens: 1_000_000, output_tokens: 500_000 }, { "openai/known": { inputPerMillion: 2, outputPerMillion: 4 } }), { estimatedCostUsd: 4, priced: true });
  assert.deepEqual(estimateUsageCost("openai", "unknown", {}, {}), { estimatedCostUsd: null, priced: false });
  const result = aggregateUsage([{ timestamp: "2026-01-02", workspaceCode: "a", traceId: "t", ok: true, totalTokens: 12, estimatedCostUsd: 0.2, priced: true, latencyMs: 100 }, { timestamp: "2026-01-02", workspaceCode: "b", ok: false, totalTokens: 9, priced: false, latencyMs: 300 }], { workspaceCode: "a" });
  assert.equal(result.totals.requests, 1); assert.equal(result.totals.totalTokens, 12); assert.equal(result.totals.averageLatencyMs, 100);
});