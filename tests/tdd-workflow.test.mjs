import test from "node:test";
import assert from "node:assert/strict";
import {
  approveTddCommit,
  createTddWorkflow,
  markTestsWritten,
  recordTddTestResult,
  tddNextAction
} from "../src/tdd-workflow.js";

test("TDD workflow requires tests, bounds retries, and only becomes commit-ready after a pass", () => {
  let state = createTddWorkflow({ testCommand: "npm test", maxAttempts: 2 });
  assert.equal(tddNextAction(state), "write_tests");
  state = markTestsWritten(state, { testFile: "tests/example.test.mjs" });
  assert.equal(tddNextAction(state), "run_tests");
  state = recordTddTestResult(state, { passed: false, exitCode: 1, stderr: "expected true" });
  assert.equal(state.status, "repairing");
  assert.equal(state.commitReady, false);
  state = recordTddTestResult(state, { passed: true, exitCode: 0, stdout: "ok" });
  assert.equal(state.status, "passed");
  assert.equal(tddNextAction(state), "request_commit_approval");
  state = approveTddCommit(state);
  assert.equal(state.commitApproved, true);
  assert.equal(tddNextAction(state), "commit");
});

test("TDD workflow stops after the configured retry bound", () => {
  let state = markTestsWritten(createTddWorkflow({ testCommand: "pytest", maxAttempts: 1 }));
  state = recordTddTestResult(state, { passed: false, exitCode: 1, stderr: "failure" });
  assert.equal(state.status, "failed");
  assert.equal(state.commitReady, false);
  assert.throws(() => approveTddCommit(state), /passing TDD workflow/);
});
