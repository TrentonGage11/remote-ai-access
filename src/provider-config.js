export const PROVIDER_API_KEY_ENV_NAMES = Object.freeze({
  deepseek: Object.freeze(["DEEPSEEK_API_KEY"]),
  anthropic: Object.freeze(["ANTHROPIC_API_KEY", "ANTHROPIC_CLAUDE_API_KEY"]),
  together: Object.freeze(["TOGETHER_API_KEY", "TOGETHER_AI_API_KEY"]),
  openrouter: Object.freeze(["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"])
});

export function firstConfiguredEnv(env, names, fallback = "") {
  for (const name of names) {
    const value = String(env?.[name] || "").trim();
    if (value) return value;
  }
  return String(fallback || "").trim();
}

export function resolveProviderApiKey(provider, env = process.env) {
  return firstConfiguredEnv(env, PROVIDER_API_KEY_ENV_NAMES[provider] || []);
}

export function parseProviderModelList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isValidProviderModelName(value) {
  return typeof value === "string"
    && value.length >= 2
    && value.length <= 180
    && /^[a-zA-Z0-9~][a-zA-Z0-9._:/+@~-]+$/.test(value);
}

export function resolveProviderModel({ requestedModel, defaultModel, allowedModels = [] }) {
  const validAllowedModels = allowedModels.filter(isValidProviderModelName);
  const fallbackModel = validAllowedModels.length > 0 && !validAllowedModels.includes(defaultModel)
    ? validAllowedModels[0]
    : defaultModel;
  if (!isValidProviderModelName(requestedModel)) return fallbackModel;
  if (validAllowedModels.length > 0 && !validAllowedModels.includes(requestedModel)) return fallbackModel;
  return requestedModel;
}

export function selectDefaultProvider(configuredProviders, requestedProvider = "") {
  const providers = Array.isArray(configuredProviders) ? configuredProviders : [];
  const requested = String(requestedProvider || "").trim().toLowerCase();
  if (providers.includes(requested)) return requested;
  if (providers.includes("openai")) return "openai";
  return providers[0] || "";
}
