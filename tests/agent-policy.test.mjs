import test from "node:test";
import assert from "node:assert/strict";

import {
  filterAgentToolDefinitions,
  isAgentToolAllowed,
  normalizeAgentToolProfile
} from "../src/agent-policy.js";

test("unknown profiles preserve legacy full access", () => {
  assert.equal(normalizeAgentToolProfile("unknown"), "full");
  assert.equal(isAgentToolAllowed("run_terminal", "unknown"), true);
});

test("read-only profile blocks mutating and terminal tools", () => {
  assert.equal(isAgentToolAllowed("read_file", "read-only"), true);
  assert.equal(isAgentToolAllowed("search_workspace", "read-only"), true);
  assert.equal(isAgentToolAllowed("write_file", "read-only"), false);
  assert.equal(isAgentToolAllowed("run_terminal", "read-only"), false);
  assert.equal(isAgentToolAllowed("run_tests", "read-only"), false);
  assert.equal(isAgentToolAllowed("manage_snapshots", "read-only"), false);
  assert.equal(isAgentToolAllowed("spawn_subagent", "read-only"), true);
  assert.equal(isAgentToolAllowed("wait_subagents", "read-only"), true);
});

test("standard profile blocks high-impact tools but allows workspace edits", () => {
  assert.equal(isAgentToolAllowed("write_file", "standard"), true);
  assert.equal(isAgentToolAllowed("lint_code", "standard"), true);
  assert.equal(isAgentToolAllowed("run_terminal", "standard"), false);
  assert.equal(isAgentToolAllowed("git_ops", "standard"), false);
});

test("deployment profile exclusively owns the deployment tool", () => {
  assert.equal(normalizeAgentToolProfile("deployment"), "deployment");
  assert.equal(isAgentToolAllowed("deploy_application", "deployment"), true);
  assert.equal(isAgentToolAllowed("read_file", "deployment"), true);
  assert.equal(isAgentToolAllowed("write_file", "deployment"), false);
  assert.equal(isAgentToolAllowed("run_terminal", "deployment"), false);
  assert.equal(isAgentToolAllowed("deploy_application", "read-only"), false);
  assert.equal(isAgentToolAllowed("deploy_application", "standard"), false);
  assert.equal(isAgentToolAllowed("deploy_application", "full"), false);
});

test("definition filtering only exposes tools allowed by the profile", () => {
  const definitions = ["read_file", "write_file", "run_terminal"].map((name) => ({
    type: "function",
    function: { name }
  }));
  assert.deepEqual(
    filterAgentToolDefinitions(definitions, "read-only").map((item) => item.function.name),
    ["read_file"]
  );
});