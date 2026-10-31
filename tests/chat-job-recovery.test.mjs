import test from "node:test";
import assert from "node:assert/strict";

import { disclosureKey, getJobRecoveryMessage, hasRecoveredJob } from "../public/chat-job-recovery.js";

test("extracts a completed job for chat recovery", () => {
  const recovered = getJobRecoveryMessage({
    id: "job-1",
    traceId: "trace-1",
    status: "completed",
    recovery: { prompt: "continue this", model: "model-1" },
    result: { reply: "finished", executedTools: ["read_file"] }
  });
  assert.equal(recovered.jobId, "job-1");
  assert.equal(recovered.prompt, "continue this");
  assert.equal(recovered.reply, "finished");
  assert.deepEqual(recovered.executedTools, ["read_file"]);
});

test("recovery is idempotent and disclosures have stable keys", () => {
  assert.equal(hasRecoveredJob({ messages: [{ jobId: "job-1" }] }, "job-1"), true);
  assert.equal(hasRecoveredJob({ messages: [] }, "job-1"), false);
  assert.equal(disclosureKey("queue", "job-1", "result"), "queue:job-1:result");
});