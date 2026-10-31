import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceActivityTimeline } from "../src/workspace-activity.js";

const input = {
  auditEntries: [{
    timestamp: "2026-08-29T10:00:00.000Z",
    operation: "git_ops",
    traceId: "trace-a",
    details: { action: "commit" }
  }],
  chatJobs: [{
    id: "job-1",
    traceId: "trace-a",
    status: "completed",
    events: [{ id: "evt-1", type: "tool-end", timestamp: "2026-08-29T10:02:00.000Z", payload: { name: "read_file" } }]
  }],
  subagentJobs: [{
    id: "child-1",
    parentId: "job-1",
    role: "review",
    status: "failed",
    events: [{ type: "failed", timestamp: "2026-08-29T10:01:00.000Z", payload: { message: "bounded failure" } }]
  }]
};

test("buildWorkspaceActivityTimeline combines sources in reverse chronological order", () => {
  const events = buildWorkspaceActivityTimeline(input);
  assert.deepEqual(events.map((event) => event.source), ["agent", "subagent", "audit"]);
  assert.deepEqual(events.map((event) => event.category), ["tool", "failure", "git"]);
});

test("buildWorkspaceActivityTimeline filters by category, trace, date, and text", () => {
  assert.equal(buildWorkspaceActivityTimeline(input, { category: "failure" }).length, 1);
  assert.equal(buildWorkspaceActivityTimeline(input, { traceId: "trace-a" }).length, 2);
  assert.equal(buildWorkspaceActivityTimeline(input, { from: "2026-08-29T10:01:30Z" }).length, 1);
  assert.equal(buildWorkspaceActivityTimeline(input, { query: "commit" }).length, 1);
});