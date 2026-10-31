import assert from "node:assert/strict";
import test from "node:test";
import { collectSubagentArtifacts, extractSubagentContextProposals, mergeSubagentAcceptance } from "../src/subagent-results.js";

test("collectSubagentArtifacts keeps unique safe paths from successful tools", () => {
  const events = [
    { type: "tool-end", payload: { name: "generate_image", ok: true, output: { path: "images/result.png" } } },
    { type: "tool-end", payload: { name: "write_file", ok: true, output: { path: "../escape.txt" } } },
    { type: "tool-end", payload: { name: "write_file", ok: false, output: { path: "failed.txt" } } },
    { type: "tool-end", payload: { name: "read_file", ok: true, output: { path: "src/input.js" } } },
    { type: "tool-end", payload: { name: "list_directory", ok: true, output: { path: "src" } } },
    { type: "tool-end", payload: { name: "process_image", ok: true, output: { outputPath: "images/result.png" } } }
  ];
  assert.deepEqual(collectSubagentArtifacts(events), [{ path: "images/result.png", tool: "generate_image" }]);
});

test("extractSubagentContextProposals parses bounded explicit directives", () => {
  const summary = [
    "Result.",
    "```raa-context add",
    "scope: global",
    "label: Build command",
    "npm test",
    "```",
    "```raa-context remove",
    "scope: chat",
    "id: stale-1",
    "```"
  ].join("\n");
  assert.deepEqual(extractSubagentContextProposals(summary), [
    { action: "add", scope: "global", id: "", label: "Build command", newLabel: "", content: "npm test" },
    { action: "remove", scope: "chat", id: "stale-1", label: "", newLabel: "", content: "" }
  ]);
});

test("mergeSubagentAcceptance accepts only declared child output", () => {
  const job = {
    result: {
      artifacts: [{ path: "images/result.png" }],
      proposedContextMutations: [{ action: "add", content: "npm test" }]
    },
    acceptance: { artifacts: { "images/result.png": "rejected" }, context: {} }
  };
  const merged = mergeSubagentAcceptance(job, {
    artifacts: { "images/result.png": "accepted" },
    context: { 0: "accepted" }
  });
  assert.equal(merged.artifacts["images/result.png"], "accepted");
  assert.equal(merged.context["0"], "accepted");
  assert.throws(() => mergeSubagentAcceptance(job, { artifacts: { "other.txt": "accepted" } }), /unknown/);
});