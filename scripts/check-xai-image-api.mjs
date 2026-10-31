import fs from "node:fs";
import { execFileSync } from "node:child_process";

const pid = execFileSync("systemctl", ["show", "remote-ai-access", "-p", "MainPID", "--value"], { encoding: "utf8" }).trim();
const serviceEnvironment = Object.fromEntries(
  fs.readFileSync(`/proc/${pid}/environ`)
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((item) => {
      const separator = item.indexOf("=");
      return [item.slice(0, separator), item.slice(separator + 1)];
    })
);

const apiKey = serviceEnvironment.XAI_API_KEY || "";
if (!apiKey) throw new Error("XAI_API_KEY is not configured");
const baseUrl = String(serviceEnvironment.XAI_API_BASE_URL || "https://api.x.ai/v1").replace(/\/+$/, "");
const model = serviceEnvironment.XAI_IMAGE_MODEL || "grok-imagine-image";
const authorization = { Authorization: `Bearer ${apiKey}` };

const modelsResponse = await fetch(`${baseUrl}/models`, { headers: authorization });
const modelsPayload = await modelsResponse.json();
const imageModels = (Array.isArray(modelsPayload?.data) ? modelsPayload.data : [])
  .map((item) => String(item?.id || ""))
  .filter((id) => /image|imagine/i.test(id));

const generationResponse = await fetch(`${baseUrl}/images/generations`, {
  method: "POST",
  headers: { ...authorization, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    prompt: "A flat green circle centered on a transparent background",
    response_format: "b64_json"
  })
});
const generationText = await generationResponse.text();

console.log(JSON.stringify({
  modelCatalogStatus: modelsResponse.status,
  imageModels,
  configuredModel: model,
  generationStatus: generationResponse.status,
  generationBody: generationText.slice(0, 1000)
}));

if (!modelsResponse.ok || !generationResponse.ok) process.exitCode = 1;