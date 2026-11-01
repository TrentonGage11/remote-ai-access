const THEME_STORAGE_KEY = "remote-ai-access-theme";
const variantsEl = document.getElementById("compareVariants");
const promptEl = document.getElementById("comparePrompt");
const statusEl = document.getElementById("compareStatus");
const resultsEl = document.getElementById("compareResults");
const addVariantBtn = document.getElementById("addCompareVariantBtn");
const runBtn = document.getElementById("runCompareBtn");
let config = null;

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeToggle").textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function providerModels(provider) {
  const models = config?.allowedModelsByProvider?.[provider];
  const fallback = config?.defaultModelsByProvider?.[provider];
  return [...new Set([...(Array.isArray(models) ? models : []), fallback].filter(Boolean))];
}

function makeVariant(initial = {}) {
  const row = document.createElement("div");
  row.className = "compare-variant";
  const provider = document.createElement("select");
  provider.setAttribute("aria-label", "Comparison provider");
  const model = document.createElement("select");
  model.setAttribute("aria-label", "Comparison model");
  const remove = document.createElement("button");
  remove.className = "btn btn-soft";
  remove.type = "button";
  remove.textContent = "Remove";
  const providers = Array.isArray(config?.supportedProviders) ? config.supportedProviders : [];
  providers.forEach((name) => { const option = new Option(name, name); provider.add(option); });
  provider.value = initial.provider || providers[0] || "";
  const refreshModels = () => {
    model.replaceChildren();
    providerModels(provider.value).forEach((name) => model.add(new Option(name, name)));
    if (initial.model && [...model.options].some((option) => option.value === initial.model)) model.value = initial.model;
  };
  provider.addEventListener("change", refreshModels);
  remove.addEventListener("click", () => { if (variantsEl.children.length > 2) row.remove(); });
  refreshModels();
  row.append(provider, model, remove);
  variantsEl.appendChild(row);
}

function renderResults(data) {
  resultsEl.replaceChildren();
  for (const result of data.results || []) {
    const card = document.createElement("article");
    card.className = `compare-result ${result.ok ? "" : "compare-result-error"}`;
    const heading = document.createElement("div");
    heading.className = "compare-result-heading";
    const title = document.createElement("strong");
    title.textContent = `${result.provider || "unknown"} · ${result.model || "unknown"}`;
    const metrics = document.createElement("small");
    const tokens = result.usage?.total_tokens || result.usage?.totalTokens || "n/a";
    metrics.textContent = `${result.latencyMs} ms · ${tokens} tokens`;
    heading.append(title, metrics);
    const body = document.createElement("pre");
    body.textContent = result.ok ? String(result.reply || "") : `Error: ${result.error}`;
    card.append(heading, body);
    resultsEl.appendChild(card);
  }
}

document.getElementById("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});
addVariantBtn.addEventListener("click", () => makeVariant());
runBtn.addEventListener("click", async () => {
  const prompt = String(promptEl.value || "").trim();
  const variants = [...variantsEl.children].map((row) => ({ provider: row.children[0].value, model: row.children[1].value }));
  if (!prompt) { statusEl.textContent = "Enter a prompt first."; return; }
  if (variants.length < 2) { statusEl.textContent = "Add at least two providers."; return; }
  runBtn.disabled = true;
  statusEl.textContent = "Comparing…";
  try {
    const response = await fetch("/api/chat/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: prompt }], variants }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Comparison failed");
    renderResults(data);
    statusEl.textContent = `Comparison complete (${data.comparisonId}).`;
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    runBtn.disabled = false;
  }
});

const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
applyTheme(storedTheme === "dark" ? "dark" : "light");
fetch("/api/config").then((response) => response.json()).then((data) => {
  config = data;
  makeVariant({ provider: data.defaultProvider, model: data.defaultModelsByProvider?.[data.defaultProvider] });
  makeVariant({ provider: data.supportedProviders?.[1] || data.defaultProvider, model: data.defaultModelsByProvider?.[data.supportedProviders?.[1] || data.defaultProvider] });
  statusEl.textContent = "Ready.";
}).catch((error) => { statusEl.textContent = `Provider catalog error: ${error.message}`; });
