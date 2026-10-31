import test from "node:test";
import assert from "node:assert/strict";

import {
  isSubagentWritePathAllowed,
  normalizeSubagentAllowedPaths,
  normalizeSubagentLimits,
  normalizeSubagentRole,
  resolveSubagentAllowedTools,
  SUBAGENT_LIMITS
} from "../src/subagent-policy.js";

test("accepts bounded research, review, image, and coding roles", () => {
  assert.equal(normalizeSubagentRole("research"), "research");
  assert.equal(normalizeSubagentRole("review"), "review");
  assert.equal(normalizeSubagentRole("image"), "image");
  assert.equal(normalizeSubagentRole("coding"), "coding");
});

test("child tools intersect role, request, and parent permissions", () => {
  assert.deepEqual(resolveSubagentAllowedTools({
    role: "research",
    requestedTools: ["read_file", "search_workspace", "write_file", "run_terminal", "spawn_subagent"],
    parentTools: ["read_file", "write_file", "run_terminal", "spawn_subagent"]
  }), ["read_file"]);
});

test("child limits are bounded server-side", () => {
  assert.deepEqual(normalizeSubagentLimits({ maxSteps: 999, timeoutMs: 99_000_000 }), {
    maxSteps: SUBAGENT_LIMITS.maxSteps,
    timeoutMs: SUBAGENT_LIMITS.maxRuntimeMs
  });
});

test("child step defaults scale by role", () => {
  assert.deepEqual(normalizeSubagentLimits({}, "research"), { maxSteps: 64, timeoutMs: 15 * 60 * 1000 });
  assert.deepEqual(normalizeSubagentLimits({}, "review"), { maxSteps: 96, timeoutMs: 20 * 60 * 1000 });
  assert.deepEqual(normalizeSubagentLimits({}, "image"), { maxSteps: 64, timeoutMs: 15 * 60 * 1000 });
  assert.deepEqual(normalizeSubagentLimits({}, "coding"), { maxSteps: 128, timeoutMs: 30 * 60 * 1000 });
  assert.equal(SUBAGENT_LIMITS.maxChildrenPerParent, 8);
  assert.equal(SUBAGENT_LIMITS.maxConcurrentPerParent, 4);
  assert.equal(SUBAGENT_LIMITS.maxSteps, 256);
});

test("image children receive only parent-approved image tools", () => {
  assert.deepEqual(resolveSubagentAllowedTools({
    role: "image",
    requestedTools: ["search_images", "generate_image", "write_file", "run_terminal"],
    parentTools: ["search_images", "generate_image", "write_file", "run_terminal"]
  }), ["search_images", "generate_image"]);
});

test("coding children receive bounded file tools but no destructive or terminal tools", () => {
  assert.deepEqual(resolveSubagentAllowedTools({
    role: "coding",
    requestedTools: ["read_file", "format_code", "lint_code", "run_tests", "write_file", "delete_file", "run_terminal", "run_build"],
    parentTools: ["read_file", "format_code", "lint_code", "run_tests", "write_file", "delete_file", "run_terminal", "run_build"]
  }), ["read_file", "format_code", "lint_code", "run_tests", "write_file"]);
});

test("coding write paths support exact files and explicit directory scopes", () => {
  assert.deepEqual(normalizeSubagentAllowedPaths([
    "./src/app.js", "src/app.js", "../secret", "/absolute", "public/app.js"
  ]), ["src/app.js", "public/app.js"]);
  assert.equal(isSubagentWritePathAllowed("src/app.js", ["src/app.js"]), true);
  assert.equal(isSubagentWritePathAllowed("src/other.js", ["src/app.js"]), false);
  assert.equal(isSubagentWritePathAllowed("src/app.js/child", ["src/app.js"]), false);
  assert.equal(isSubagentWritePathAllowed("src/nested/app.js", ["src/"]), true);
  assert.equal(isSubagentWritePathAllowed("tests/app.test.js", ["src/"]), false);
});