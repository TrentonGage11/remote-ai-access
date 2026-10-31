import test from "node:test";
import assert from "node:assert/strict";

import { buildBoundedAgentConversation, serializeBoundedToolOutput } from "../src/compatible-agent-context.js";

test("bounds tool output while retaining both ends", () => {
  const serialized = serializeBoundedToolOutput({ value: `start-${"x".repeat(5000)}-end` }, 500);
  assert.ok(serialized.length <= 500);
  assert.match(serialized, /start-/);
  assert.match(serialized, /-end/);
});

test("drops oldest complete tool rounds without orphaning tool responses", () => {
  const prefix = [
    { role: "system", content: "system" },
    { role: "user", content: "large task" }
  ];
  const round = (id) => [
    { role: "assistant", content: "", tool_calls: [{ id, function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", tool_call_id: id, content: `${id}-${"x".repeat(700)}` }
  ];
  const bounded = buildBoundedAgentConversation([...prefix, ...round("old"), ...round("new")], prefix.length, 1300);

  assert.deepEqual(bounded.slice(0, prefix.length), prefix);
  assert.equal(bounded.some((message) => message.tool_call_id === "old"), false);
  assert.equal(bounded.some((message) => message.tool_call_id === "new"), true);
  for (const message of bounded.filter((item) => item.role === "tool")) {
    assert.ok(bounded.some((item) => item.tool_calls?.some((call) => call.id === message.tool_call_id)));
  }
});