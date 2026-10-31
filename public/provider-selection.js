const PROVIDER_LABELS = Object.freeze({
  openai: "OpenAI",
  copilot: "GitHub Copilot",
  xai: "xAI",
  google: "Google",
  deepseek: "DeepSeek",
  anthropic: "Anthropic Claude",
  together: "Together AI",
  openrouter: "OpenRouter"
});

export function providerLabel(provider) {
  return PROVIDER_LABELS[provider]
    || (provider ? provider[0].toUpperCase() + provider.slice(1) : "");
}

export function providerDefaultModel(config, modelCatalog, provider, chatCapableTypes) {
  const allowedModels = providerAllowedModels(config, provider);
  const configured = config?.defaultModelsByProvider?.[provider];
  if (allowedModels.length > 0 && !allowedModels.includes(configured)) return allowedModels[0];
  if (typeof configured === "string" && configured) return configured;

  const catalogDefault = (Array.isArray(modelCatalog) ? modelCatalog : [])
    .find((item) => item.provider === provider && chatCapableTypes.has(item.type))?.tag;
  if (catalogDefault) return catalogDefault;
  if (provider === "xai") return config?.xaiDefaultModel || "grok-4.6";
  return config?.defaultModel || "gpt-4.1";
}

export function providerAllowedModels(config, provider) {
  if (Object.prototype.hasOwnProperty.call(config?.allowedModelsByProvider || {}, provider)) {
    const models = config.allowedModelsByProvider[provider];
    return Array.isArray(models) ? models : [];
  }
  if (provider === "openai") return Array.isArray(config?.allowedModels) ? config.allowedModels : [];
  if (provider === "xai") return Array.isArray(config?.xaiAllowedModels) ? config.xaiAllowedModels : [];
  return [];
}

export function providerModelOptions({ config, modelCatalog, provider, chatCapableTypes, fallbackModels = [] }) {
  const catalogModels = (Array.isArray(modelCatalog) ? modelCatalog : [])
    .filter((item) => item.provider === provider && chatCapableTypes.has(item.type))
    .map((item) => item.tag);
  const defaultModel = providerDefaultModel(config, modelCatalog, provider, chatCapableTypes);
  const allowedModels = providerAllowedModels(config, provider);

  let candidates = [defaultModel, ...catalogModels];
  if (catalogModels.length === 0 && provider === "openai") candidates.push(...fallbackModels);
  if (allowedModels.length > 0) {
    const allowed = new Set(allowedModels);
    candidates = [defaultModel, ...catalogModels.filter((model) => allowed.has(model)), ...allowedModels];
  }

  return [...new Set(candidates.filter((model) => typeof model === "string" && model))];
}

export function providerSupportsAgentModel(config, provider, model) {
  if (!Array.isArray(config?.agentModeSupportedProviders) || !config.agentModeSupportedProviders.includes(provider)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(config?.agentModeModelsByProvider || {}, provider)) {
    return true;
  }
  const models = config.agentModeModelsByProvider[provider];
  return Array.isArray(models) && models.includes(model);
}

export function providerAgentModelOptions(options) {
  const models = providerModelOptions(options);
  const { config, provider } = options;
  if (!Object.prototype.hasOwnProperty.call(config?.agentModeModelsByProvider || {}, provider)) {
    return models;
  }
  const configuredAgentModels = Array.isArray(config.agentModeModelsByProvider[provider])
    ? config.agentModeModelsByProvider[provider]
    : [];
  const allowedModels = providerAllowedModels(config, provider);
  const eligibleAgentModels = configuredAgentModels.filter((model) => (
    isValidCatalogModelTag(model)
    && (allowedModels.length === 0 || allowedModels.includes(model))
  ));
  const eligibleSet = new Set(eligibleAgentModels);
  return [...new Set([...models.filter((model) => eligibleSet.has(model)), ...eligibleAgentModels])];
}

export function isValidCatalogModelTag(value) {
  return typeof value === "string"
    && value.length >= 2
    && value.length <= 180
    && /^[a-zA-Z0-9~][a-zA-Z0-9._:/+@~-]+$/.test(value);
}
