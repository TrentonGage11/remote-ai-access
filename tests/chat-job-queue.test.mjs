import test from "node:test";
import assert from "node:assert/strict";

import {
  compareQueuedChatJobs,
  normalizeChatJobPriority,
  orderedQueuedChatJobs,
  selectDispatchableChatJobs
} from "../src/chat-job-queue.js";

test("normalizes unknown priorities to normal", () => {
  assert.equal(normalizeChatJobPriority("urgent"), "urgent");
  assert.equal(normalizeChatJobPriority("HIGH"), "high");
  assert.equal(normalizeChatJobPriority("something-else"), "normal");
});

test("orders queued jobs by priority then creation time", () => {
  const jobs = [
    { id: "normal", status: "queued", priority: "normal", workspaceCode: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "urgent-new", status: "queued", priority: "urgent", workspaceCode: "a", createdAt: "2026-01-01T00:02:00.000Z" },
    { id: "urgent-old", status: "queued", priority: "urgent", workspaceCode: "a", createdAt: "2026-01-01T00:01:00.000Z" },
    { id: "done", status: "completed", priority: "urgent", workspaceCode: "a", createdAt: "2026-01-01T00:00:00.000Z" }
  ];

  assert.deepEqual(orderedQueuedChatJobs(jobs).map((job) => job.id), ["urgent-old", "urgent-new", "normal"]);
  assert.ok(compareQueuedChatJobs(jobs[1], jobs[0]) < 0);
});

test("omits queued jobs from paused workspaces", () => {
  const jobs = [
    { id: "paused", status: "queued", priority: "urgent", workspaceCode: "a" },
    { id: "ready", status: "queued", priority: "normal", workspaceCode: "b" }
  ];

  assert.deepEqual(orderedQueuedChatJobs(jobs, new Set(["a"])).map((job) => job.id), ["ready"]);
});

test("dispatch selection honors global and per-workspace limits", () => {
  const jobs = [
    { id: "a-running", status: "running", priority: "normal", workspaceCode: "a" },
    { id: "a-queued", status: "queued", priority: "urgent", workspaceCode: "a" },
    { id: "b-first", status: "queued", priority: "high", workspaceCode: "b" },
    { id: "b-second", status: "queued", priority: "normal", workspaceCode: "b" }
  ];
  const selected = selectDispatchableChatJobs(jobs, {
    globalSlots: 2,
    defaultWorkspaceLimit: 2,
    workspaceLimits: new Map([["a", 1], ["b", 1]])
  });
  assert.deepEqual(selected.map((job) => job.id), ["b-first"]);
});
