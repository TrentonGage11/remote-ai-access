import test from "node:test";
import assert from "node:assert/strict";
import { appendMetricSample, calculateCpuPercent, summarizeRuntimeSample } from "../src/runtime-monitor.js";

test("calculates host CPU usage from cumulative snapshots", () => {
  assert.equal(calculateCpuPercent({ idle: 100, total: 200 }, { idle: 125, total: 300 }), 75);
  assert.equal(calculateCpuPercent(null, { idle: 1, total: 2 }), null);
});

test("bounds metric history and reports threshold alerts", () => {
  assert.deepEqual(appendMetricSample([{ id: 1 }, { id: 2 }], { id: 3 }, 2), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(summarizeRuntimeSample({ cpuPercent: 90, memoryPercent: 20, diskPercent: 30, queue: { queued: 12 } }).alerts, ["CPU usage is high", "Agent queue depth is high"]);
});