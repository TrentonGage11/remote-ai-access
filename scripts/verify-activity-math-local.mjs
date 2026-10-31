import "dotenv/config";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8890";
const basicToken = Buffer.from(`${process.env.BASIC_AUTH_USER || ""}:${process.env.BASIC_AUTH_PASS || ""}`).toString("base64");
const headers = { Authorization: `Basic ${basicToken}` };

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  return { response, text };
}

const [activityPage, activityApi, katexModule, katexStyles] = await Promise.all([
  fetchText("/activity.html"),
  fetchText("/api/activity?limit=10"),
  fetchText("/vendor/katex/katex.mjs"),
  fetchText("/vendor/katex/katex.min.css")
]);

const apiPayload = JSON.parse(activityApi.text);
const output = {
  activityPage: activityPage.response.ok && activityPage.text.includes("Activity Timeline"),
  activityApi: activityApi.response.ok && Array.isArray(apiPayload.events),
  workspaceCode: apiPayload.workspaceCode || null,
  eventCount: Array.isArray(apiPayload.events) ? apiPayload.events.length : null,
  katexModule: katexModule.response.ok && katexModule.text.includes("renderToString"),
  katexStyles: katexStyles.response.ok && katexStyles.text.includes(".katex")
};

console.log(JSON.stringify(output));
if (Object.entries(output).some(([key, value]) => !["workspaceCode", "eventCount"].includes(key) && value !== true)) {
  process.exitCode = 1;
}