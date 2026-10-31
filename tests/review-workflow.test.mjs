import test from "node:test";
import assert from "node:assert/strict";
import { acceptReviewWorkflow, createReviewWorkflow, recordReviewStage } from "../src/review-workflow.js";

test("review graph requires optimizer, chaos, and security stages before acceptance", () => {
  let state = createReviewWorkflow();
  state = recordReviewStage(state, "optimizer", { passed: true });
  state = recordReviewStage(state, "chaos", { passed: true, findings: ["boundary case checked"] });
  state = recordReviewStage(state, "security", { passed: true });
  assert.equal(state.status, "ready_for_acceptance");
  assert.equal(acceptReviewWorkflow(state, true).status, "accepted");
});

test("failed review stage requests changes", () => {
  let state = createReviewWorkflow();
  state = recordReviewStage(state, "optimizer", { passed: false, findings: ["regression"] });
  assert.equal(state.status, "changes_requested");
  assert.throws(() => acceptReviewWorkflow(state, true), /all review stages/);
});
