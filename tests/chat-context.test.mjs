import test from "node:test";
import assert from "node:assert/strict";

import { resolveProviderMessageContext } from "../src/chat-context.js";

const limits = {
  messageMaxChars: 1200,
  contextMaxChars: 2600,
  summaryMaxChars: 500
};

test("persistent context is included without compaction", () => {
  const result = resolveProviderMessageContext({
    persistentContext: "standing context marker",
    messages: [{ role: "user", content: "latest request" }],
    autoCompact: true
  }, limits);

  assert.equal(result.compaction.applied, false);
  assert.equal(result.compaction.persistentContextApplied, true);
  assert.equal(result.messages[0].content, "standing context marker");
  assert.equal(result.messages.at(-1).content, "latest request");
});

test("compaction preserves persistent context and newest chat message", () => {
  const result = resolveProviderMessageContext({
    persistentContext: `standing context marker ${"c".repeat(900)}`,
    messages: [
      { role: "user", content: `old request ${"a".repeat(900)}` },
      { role: "assistant", content: `old reply ${"b".repeat(900)}` },
      { role: "user", content: "newest request marker" }
    ],
    autoCompact: true
  }, limits);

  assert.equal(result.compaction.applied, true);
  assert.equal(result.compaction.persistentContextApplied, true);
  assert.match(result.messages[0].content, /^standing context marker/);
  assert.equal(result.messages.at(-1).content, "newest request marker");
  assert.ok(result.compaction.compactedMessageCount > 0);
  assert.ok(result.messages.reduce((total, message) => total + message.content.length, 0) <= limits.contextMaxChars);
});