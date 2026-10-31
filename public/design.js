import {
  providerDefaultModel,
  providerLabel,
  providerModelOptions
} from "./provider-selection.js";

const themeToggleEl = document.getElementById("themeToggle");
const providerEl = document.getElementById("providerSelect");
const modelEl = document.getElementById("modelSelect");
const projectEl = document.getElementById("projectInput");
const contextEl = document.getElementById("contextInput");
const artifactEl = document.getElementById("artifactInput");
const workspaceNameEl = document.getElementById("workspaceNameInput");
const createWorkspaceBtnEl = document.getElementById("createWorkspaceBtn");
const statusEl = document.getElementById("designStatus");
const THEME_KEY = "remote-ai-access-theme";
const ARTIFACT_KEY = "remote-ai-access-design-artifact-v1";
const CHAT_CAPABLE_TYPES = new Set(["text", "code", "chatgpt", "research", "open-weight", "search", "tool"]);
const FALLBACK_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.3-codex", "gpt-5", "gpt-4.1"];
const DEFAULT_CONFIG = {
  defaultProvider: "openai",
  defaultModel: "gpt-4.1",
  xaiDefaultModel: "grok-4.6",
  allowedModels: [],
  xaiAllowedModels: [],
  defaultModelsByProvider: {},
  allowedModelsByProvider: {},
  supportedProviders: ["openai"]
};
let config = { ...DEFAULT_CONFIG };
let modelCatalog = [];

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleEl.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

applyTheme(localStorage.getItem(THEME_KEY) || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
artifactEl.value = localStorage.getItem(ARTIFACT_KEY) || "";

function normalizeProvider(value) {
  return String(value || "").trim().toLowerCase();
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

async function loadProviderCatalog() {
  try {
    const [configResponse, catalogResponse] = await Promise.all([
      fetch("/api/config", { cache: "no-store" }),
      fetch("/models.csv", { cache: "no-store" })
    ]);
    if (configResponse.ok) {
      const data = await configResponse.json();
      config = {
        ...config,
        ...data,
        defaultProvider: normalizeProvider(data.defaultProvider) || config.defaultProvider,
        supportedProviders: Array.isArray(data.supportedProviders)
          ? data.supportedProviders.map(normalizeProvider).filter(Boolean)
          : config.supportedProviders
      };
    }
    if (catalogResponse.ok) {
      const lines = (await catalogResponse.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1) {
        const header = parseCsvLine(lines[0]);
        const providerIndex = header.indexOf("Provider");
        const agencyIndex = header.indexOf("Agency");
        const tagIndex = header.indexOf("Model Tag");
        const typeIndex = header.indexOf("Type");
        modelCatalog = lines.slice(1).map((line) => {
          const parts = parseCsvLine(line);
          const tag = parts[tagIndex] || "";
          return {
            provider: normalizeProvider(parts[providerIndex >= 0 ? providerIndex : agencyIndex]) || "openai",
            tag,
            type: normalizeProvider(parts[typeIndex])
          };
        }).filter((entry) => entry.tag && entry.tag.length <= 180);
      }
    }
  } catch {
    // Defaults remain usable if the catalog endpoint is unavailable.
  }

  const configured = config.supportedProviders.map(normalizeProvider).filter(Boolean);
  const catalogProviders = modelCatalog.map((entry) => entry.provider).filter(Boolean);
  const providers = [...new Set([...configured, ...catalogProviders])];
  providerEl.innerHTML = "";
  for (const provider of providers.length ? providers : [config.defaultProvider]) {
    const option = document.createElement("option");
    option.value = provider;
    option.textContent = providerLabel(provider);
    providerEl.appendChild(option);
  }
  providerEl.value = providers.includes(config.defaultProvider) ? config.defaultProvider : providerEl.options[0]?.value || "openai";
  updateModelOptions();
  statusEl.textContent = `Catalog loaded: ${providerEl.options.length} provider${providerEl.options.length === 1 ? "" : "s"}.`;
}

function updateModelOptions() {
  const provider = normalizeProvider(providerEl.value) || config.defaultProvider;
  const options = providerModelOptions({
    config,
    modelCatalog,
    provider,
    chatCapableTypes: CHAT_CAPABLE_TYPES,
    fallbackModels: FALLBACK_MODELS
  });
  modelEl.innerHTML = "";
  for (const model of options) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelEl.appendChild(option);
  }
  const defaultModel = providerDefaultModel(config, modelCatalog, provider, CHAT_CAPABLE_TYPES);
  modelEl.value = options.includes(defaultModel) ? defaultModel : options[0] || "";
}

providerEl.addEventListener("change", updateModelOptions);
loadProviderCatalog();

themeToggleEl.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

function saveArtifact() {
  localStorage.setItem(ARTIFACT_KEY, artifactEl.value);
}

function buildPrompt(stage) {
  const project = projectEl.value.trim();
  const context = contextEl.value.trim();
  const artifact = artifactEl.value.trim();
  if (!project) throw new Error("Describe the feature or project first.");

  const shared = `Feature/project:\n${project}\n\nRelevant context and constraints:\n${context || "(none supplied)"}`;
  if (stage === "brainstorm") return `Act as Elephant, the context-rich design lead. Explore this feature deeply. Identify goals, users, constraints, alternatives, risks, open questions, and a proposed direction. Do not write implementation code yet.\n\n${shared}`;
  if (stage === "draft") return `Act as Elephant. Turn the following feature and working material into an implementation-ready design specification. Include scope/non-scope, user flows, data model, API/UI changes, security/privacy, migration, testing, rollout, and explicit decisions.\n\n${shared}\n\nWorking material:\n${artifact || "(brainstorm from scratch)"}`;
  if (stage === "review") return `Act as a zero-context Goldfish reviewer. You did not participate in the earlier discussion. Review only the proposed design and the supplied source/context. Find missing requirements, unsafe assumptions, contradictions, privacy/security risks, edge cases, and test gaps. Rank findings by severity and give concrete fixes. Do not rewrite the whole design.\n\nSource/context:\n${context || "(none supplied)"}\n\nProposed design:\n${artifact || "(no draft supplied)"}`;
  return `Act as the resolving architect. Reconcile the design with the review findings. Produce a final implementation plan with accepted/rejected findings, precise changes, verification steps, and any remaining decision the human must make.\n\nFeature/project:\n${project}\n\nDesign and review material:\n${artifact || "(none supplied)"}`;
}

async function runStage(stage) {
  try {
    statusEl.textContent = "Working...";
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: providerEl.value,
        model: modelEl.value,
        autoCompact: true,
        messages: [{ role: "user", content: buildPrompt(stage) }]
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    artifactEl.value = String(data.reply || data.content || data.message || "").trim();
    saveArtifact();
    statusEl.textContent = `${stage} complete. Review the artifact before moving to the next stage.`;
  } catch (error) {
    statusEl.textContent = `Design request failed: ${error.message}`;
  }
}

async function createWorkspaceFromDesign() {
  const name = workspaceNameEl.value.trim();
  if (!name) {
    statusEl.textContent = "Enter a workspace name first.";
    workspaceNameEl.focus();
    return;
  }
  createWorkspaceBtnEl.disabled = true;
  try {
    const response = await fetch("/api/design/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        provider: providerEl.value,
        model: modelEl.value,
        stage: artifactEl.value.trim() ? "artifact-ready" : "inputs-only",
        project: projectEl.value,
        context: contextEl.value,
        artifact: artifactEl.value
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    statusEl.textContent = `Workspace created at ${data.path}. Open File Lab to continue working there.`;
  } catch (error) {
    statusEl.textContent = `Workspace creation failed: ${error.message}`;
  } finally {
    createWorkspaceBtnEl.disabled = false;
  }
}

document.getElementById("brainstormBtn").addEventListener("click", () => runStage("brainstorm"));
document.getElementById("draftBtn").addEventListener("click", () => runStage("draft"));
document.getElementById("reviewBtn").addEventListener("click", () => runStage("review"));
document.getElementById("resolveBtn").addEventListener("click", () => runStage("resolve"));
createWorkspaceBtnEl.addEventListener("click", createWorkspaceFromDesign);
artifactEl.addEventListener("input", saveArtifact);
document.getElementById("copyArtifactBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText(artifactEl.value);
  statusEl.textContent = "Artifact copied.";
});
document.getElementById("downloadArtifactBtn").addEventListener("click", () => {
  const blob = new Blob([artifactEl.value], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `design-artifact-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.md`;
  link.click();
  URL.revokeObjectURL(url);
  statusEl.textContent = "Artifact downloaded.";
});
