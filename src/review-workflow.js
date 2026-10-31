/** Bounded Phase 1 review graph. Execution remains delegated to existing agents. */
const REVIEW_STAGES = Object.freeze(["optimizer", "chaos", "security", "acceptance"]);

export function createReviewWorkflow(input = {}) {
  return {
    version: 1,
    status: "optimizer",
    stages: REVIEW_STAGES.map((name) => ({ name, status: "pending", findings: [] })),
    maxFindingsPerStage: Math.max(1, Math.min(100, Number(input.maxFindingsPerStage || 20))),
    updatedAt: new Date().toISOString()
  };
}

export function recordReviewStage(state, stage, result = {}) {
  if (!state || !REVIEW_STAGES.includes(stage)) throw new Error("unknown review stage");
  const index = state.stages.findIndex((item) => item.name === stage);
  if (index < 0) throw new Error("review stage is unavailable");
  const findings = (Array.isArray(result.findings) ? result.findings : [])
    .map((finding) => String(finding || "").trim().slice(0, 2000))
    .filter(Boolean)
    .slice(0, state.maxFindingsPerStage);
  const stages = state.stages.map((item, itemIndex) => itemIndex === index
    ? { ...item, status: result.passed === false ? "failed" : "completed", findings }
    : item);
  const failed = stages.some((item) => item.status === "failed");
  const next = stages.find((item) => item.name !== "acceptance" && item.status === "pending");
  return {
    ...state,
    stages,
    status: failed ? "changes_requested" : next?.name || "ready_for_acceptance",
    updatedAt: new Date().toISOString()
  };
}

export function acceptReviewWorkflow(state, accepted) {
  if (!state || state.status !== "ready_for_acceptance") {
    throw new Error("all review stages must complete before acceptance");
  }
  return { ...state, status: accepted ? "accepted" : "changes_requested", updatedAt: new Date().toISOString() };
}

export const REVIEW_WORKFLOW_STAGES = REVIEW_STAGES;
