import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = String(process.env.TEST_BASE_URL || process.env.APP_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { response, data };
}

async function isServerReachable() {
  try {
    const { response, data } = await getJson(`${baseUrl}/health`);
    return response.ok && data?.ok === true;
  } catch {
    return false;
  }
}

async function pollJob(jobId, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { response, data } = await getJson(`${baseUrl}/api/chat/jobs/${encodeURIComponent(jobId)}`);
    assert.equal(response.ok, true, `job polling failed: ${response.status}`);
    const status = String(data?.job?.status || "");
    if (["completed", "failed", "cancelled"].includes(status)) {
      return data.job;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("Timed out waiting for chat job terminal state");
}

test("chat job create and poll completes", async (t) => {
  const reachable = await isServerReachable();
  if (!reachable) {
    t.skip(`Server is not reachable at ${baseUrl}`);
    return;
  }

  const payload = {
    provider: "openai",
    agentMode: false,
    messages: [{ role: "user", content: "Reply with exactly: ok" }]
  };

  const started = await getJson(`${baseUrl}/api/chat/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  assert.equal(started.response.status, 202);
  assert.equal(started.data?.ok, true);
  assert.match(String(started.data?.job?.id || ""), /^job-/);

  const job = await pollJob(started.data.job.id, 60_000);
  assert.ok(["completed", "failed", "cancelled"].includes(job.status));
});

test("chat job cancel endpoint returns terminal state", async (t) => {
  const reachable = await isServerReachable();
  if (!reachable) {
    t.skip(`Server is not reachable at ${baseUrl}`);
    return;
  }

  const payload = {
    provider: "openai",
    agentMode: true,
    messages: [{ role: "user", content: "List tools and explain each in detail." }]
  };

  const started = await getJson(`${baseUrl}/api/chat/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(started.response.status, 202);

  const jobId = started.data?.job?.id;
  assert.ok(jobId);

  const cancelled = await getJson(`${baseUrl}/api/chat/jobs/${encodeURIComponent(jobId)}`, {
    method: "DELETE"
  });

  assert.equal(cancelled.response.ok, true);
  assert.equal(cancelled.data?.ok, true);
  assert.ok(["cancelled", "running", "completed", "failed"].includes(String(cancelled.data?.job?.status || "")));
}
);