/**
 * Small, provider-agnostic state machine for bounded test-driven agent runs.
 *
 * The workflow deliberately does not execute commands or create commits. The
 * server/agent runner supplies the test result and decides whether a write or
 * commit approval is allowed. Keeping this state machine pure makes retries,
 * persistence, and replay safe to test independently of a runtime container.
 */

const MAX_ATTEMPTS = 8;
const MAX_LOG_CHARS = 20_000;

function clip(value, limit = MAX_LOG_CHARS) {
  return String(value || "").slice(-Math.max(1, limit));
}

function normalizeAttemptLimit(value) {
  return Math.max(1, Math.min(MAX_ATTEMPTS, Number(value || 3)));
}

export function createTddWorkflow(input = {}) {
  const testCommand = String(input.testCommand || "").trim();
  if (!testCommand) throw new Error("testCommand is required");
  return {
    version: 1,
    status: "tests_first",
    testCommand,
    maxAttempts: normalizeAttemptLimit(input.maxAttempts),
    attempt: 0,
    testsWritten: false,
    lastResult: null,
    history: [],
    commitReady: false,
    commitApproved: false,
    updatedAt: new Date().toISOString()
  };
}

export function markTestsWritten(state, details = {}) {
  if (!state || state.status === "passed" || state.status === "failed") return state;
  return {
    ...state,
    status: "running_tests",
    testsWritten: true,
    testFile: details.testFile ? String(details.testFile).slice(0, 500) : state.testFile,
    updatedAt: new Date().toISOString()
  };
}

export function recordTddTestResult(state, result = {}) {
  if (!state || !["running_tests", "repairing", "tests_first"].includes(state.status)) return state;
  const passed = Boolean(result.passed);
  const attempt = Number(state.attempt || 0) + 1;
  const entry = {
    attempt,
    passed,
    exitCode: Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : null,
    stdout: clip(result.stdout),
    stderr: clip(result.stderr),
    createdAt: new Date().toISOString()
  };
  const nextStatus = passed
    ? "passed"
    : attempt >= state.maxAttempts
      ? "failed"
      : "repairing";
  return {
    ...state,
    status: nextStatus,
    attempt,
    lastResult: entry,
    history: [...(Array.isArray(state.history) ? state.history : []), entry].slice(-MAX_ATTEMPTS),
    commitReady: passed,
    updatedAt: new Date().toISOString()
  };
}

export function approveTddCommit(state) {
  if (!state || state.status !== "passed" || !state.commitReady) {
    throw new Error("a passing TDD workflow is required before commit approval");
  }
  return { ...state, commitApproved: true, updatedAt: new Date().toISOString() };
}

export function tddNextAction(state) {
  if (!state) return "create_workflow";
  if (state.status === "tests_first") return "write_tests";
  if (state.status === "running_tests") return "run_tests";
  if (state.status === "repairing") return "repair_code";
  if (state.status === "passed" && !state.commitApproved) return "request_commit_approval";
  if (state.status === "passed") return "commit";
  return "stop";
}

export const TDD_WORKFLOW_LIMITS = Object.freeze({ MAX_ATTEMPTS, MAX_LOG_CHARS });
