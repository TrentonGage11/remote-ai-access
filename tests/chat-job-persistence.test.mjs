import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";

import {
  readChatJobState,
  restoreChatJobState,
  serializeChatJobState,
  writeChatJobState
} from "../src/chat-job-persistence.js";

test("keeps completed results and marks interrupted jobs without replaying them", () => {
  const state = serializeChatJobState([
    {
      id: "running-1", traceId: "trace-1", status: "running", priority: "high", provider: "openai",
      agentMode: true, workspaceCode: "alpha", createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z", events: [], requestBody: { messages: [{ role: "user", content: "work" }] },
      listeners: new Set([{}]), abortController: new AbortController(), execution: { headers: { authorization: "secret" } }
    },
    {
      id: "done-1", traceId: "trace-2", status: "completed", priority: "normal", provider: "google",
      workspaceCode: "alpha", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z",
      events: [], result: { reply: "finished" }, requestBody: { messages: [] }
    }
  ], new Set(["alpha"]));

  assert.equal(JSON.stringify(state).includes("authorization"), false);
  const restored = restoreChatJobState(state, new Date("2026-01-02T00:00:00.000Z"));
  assert.equal(restored.jobs[0].status, "failed");
  assert.equal(restored.jobs[0].events.at(-1).type, "interrupted-by-restart");
  assert.equal(restored.jobs[0].listeners.size, 0);
  assert.equal(restored.jobs[1].status, "completed");
  assert.equal(restored.jobs[1].result.reply, "finished");
  assert.deepEqual([...restored.pausedWorkspaceCodes], ["alpha"]);
});

test("writes and reads queue state atomically", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "raa-chat-jobs-"));
  const filePath = path.join(directory, "jobs.json");
  const state = serializeChatJobState([]);
  await writeChatJobState(filePath, state);
  assert.deepEqual(await readChatJobState(filePath), state);
  await fsp.rm(directory, { recursive: true, force: true });
});

test("preserves a durable user question while a job is paused", () => {
  const question = {
    id: "question-1",
    jobId: "job-1",
    prompt: "Which test profile should I run?",
    choices: ["unit", "integration"],
    createdAt: "2026-01-01T00:00:00.000Z",
    answeredAt: null
  };
  const state = serializeChatJobState([{
    id: "job-1", traceId: "trace-1", status: "needs_input", workspaceCode: "alpha",
    createdAt: question.createdAt, updatedAt: question.createdAt, question,
    requestBody: { messages: [{ role: "user", content: "run the checks" }] }, events: []
  }]);
  const restored = restoreChatJobState(state);
  assert.equal(restored.jobs[0].status, "needs_input");
  assert.deepEqual(restored.jobs[0].question, question);
});
