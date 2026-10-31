import { createTddWorkflow, markTestsWritten, recordTddTestResult } from "./tdd-workflow.js";

/**
 * Run a bounded tests-first repair loop. The callbacks are deliberately
 * injected so the server can supply the model and workspace test runner while
 * this orchestration remains deterministic and easy to test.
 */
export async function runTddRepairLoop({ testCommand, maxAttempts, testFile, generateAttempt, runTest } = {}) {
  if (typeof generateAttempt !== "function" || typeof runTest !== "function") {
    throw new Error("generateAttempt and runTest callbacks are required");
  }
  let state = markTestsWritten(
    createTddWorkflow({ testCommand, maxAttempts }),
    { testFile }
  );
  let response = null;
  let feedback = "";
  while (true) {
    response = await generateAttempt({ state, feedback });
    const result = await runTest({ state, response });
    state = recordTddTestResult(state, { ...result, passed: result.passed ?? result.ok });
    if (result.ok || state.status === "failed") {
      return { state, response, testResult: result };
    }
    feedback = [
      "The automated test run failed. Repair the implementation and rerun the tests.",
      `Exit code: ${result.exitCode ?? "unknown"}`,
      `STDOUT:\n${String(result.stdout || "").slice(-12000)}`,
      `STDERR:\n${String(result.stderr || "").slice(-12000)}`
    ].join("\n");
  }
}
