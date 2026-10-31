import test from "node:test";
import assert from "node:assert/strict";
import { runTddRepairLoop } from "../src/tdd-runner.js";

test("TDD runner feeds failed test output back and stops after a pass", async () => {
  const prompts = [];
  let runs = 0;
  const result = await runTddRepairLoop({
    testCommand: "npm test",
    maxAttempts: 3,
    testFile: "tests/example.test.mjs",
    generateAttempt: async ({ feedback }) => {
      prompts.push(feedback);
      return { reply: `attempt ${prompts.length}` };
    },
    runTest: async () => {
      runs += 1;
      return runs === 1
        ? { ok: false, passed: false, exitCode: 1, stderr: "expected 2" }
        : { ok: true, passed: true, exitCode: 0, stdout: "ok" };
    }
  });
  assert.equal(result.state.status, "passed");
  assert.equal(result.state.attempt, 2);
  assert.match(prompts[1], /expected 2/);
});

test("TDD runner returns a failed workflow at the retry bound", async () => {
  const result = await runTddRepairLoop({
    testCommand: "npm test",
    maxAttempts: 1,
    generateAttempt: async () => ({ reply: "attempt" }),
    runTest: async () => ({ ok: false, passed: false, exitCode: 1, stderr: "broken" })
  });
  assert.equal(result.state.status, "failed");
  assert.equal(result.state.commitReady, false);
});
