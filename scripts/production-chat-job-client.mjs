import "dotenv/config";
import { writeFile } from "node:fs/promises";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8787";
const authorization = `Basic ${Buffer.from(`${process.env.BASIC_AUTH_USER || ""}:${process.env.BASIC_AUTH_PASS || ""}`).toString("base64")}`;
const headers = {
  Authorization: authorization,
  "Content-Type": "application/json",
  Origin: process.env.APP_BASE_URL || "https://ai.tg11.org"
};

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${data.error || "request failed"}`);
  return data;
}

const action = process.argv[2] || "active-check";
if (action === "active-check") {
  const data = await request("/api/chat/jobs");
  const active = data.jobs.filter((job) => ["starting", "checkpointing", "running"].includes(job.status));
  console.log(JSON.stringify({
    active: active.length,
    queued: data.queue.queued,
    total: data.jobs.length,
    paused: data.queue.paused,
    workspaceLimit: data.queue.workspaceMaxConcurrent,
    globalLimit: data.queue.maxConcurrent
  }));
  if (active.length > 0) process.exitCode = 2;
} else if (action === "create-canary") {
  await request("/api/chat/jobs/queue-control", { method: "POST", body: JSON.stringify({ action: "pause" }) });
  const data = await request("/api/chat/jobs", {
    method: "POST",
    body: JSON.stringify({ provider: "openai", model: "gpt-4.1", agentMode: true, priority: "low", messages: [{ role: "user", content: "durable queue restart canary" }] })
  });
  await writeFile(process.argv[3], data.job.id, "utf8");
  console.log(JSON.stringify({ created: data.job.id, status: data.job.status }));
} else if (action === "verify-canary") {
  const jobId = String(process.argv[3] || "").trim();
  const data = await request(`/api/chat/jobs/${encodeURIComponent(jobId)}`);
  if (data.job.status !== "queued") throw new Error(`expected queued canary, received ${data.job.status}`);
  await request(`/api/chat/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  await request("/api/chat/jobs/queue-control", { method: "POST", body: JSON.stringify({ action: "resume" }) });
  console.log(JSON.stringify({ persisted: jobId, status: data.job.status, cleanedUp: true }));
} else if (action === "capabilities") {
  const data = await request("/api/tools");
  const tools = data.agentToolCalling?.tools || [];
  const output = {
    imageSearch: tools.includes("search_images"),
    imageGeneration: tools.includes("generate_image"),
    imageProviders: (data.imageCapabilities?.generation || []).map((item) => `${item.provider}:${item.model}`),
    workspaceStepCodeConfigured: Boolean(data.agentStepOverridePolicy?.workspaceCodeConfigured),
    stepOverrideEnabled: Boolean(data.agentStepOverridePolicy?.enabled)
  };
  console.log(JSON.stringify(output));
  if (!output.imageSearch || !output.imageGeneration || output.imageProviders.length === 0) process.exitCode = 1;
} else {
  throw new Error(`unknown action: ${action}`);
}