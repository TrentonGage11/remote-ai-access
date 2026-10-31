import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidCatalogModelTag,
  providerAgentModelOptions,
  providerLabel,
  providerModelOptions,
  providerSupportsAgentModel
} from "../public/provider-selection.js";

const chatTypes = new Set(["text", "code"]);
const config = {
  defaultModel: "gpt-4.1",
  allowedModels: ["gpt-4.1"],
  defaultModelsByProvider: {
    deepseek: "deepseek-v4-flash",
    anthropic: "claude-sonnet-5",
    openrouter: "openrouter/auto"
  },
  allowedModelsByProvider: {
    deepseek: ["deepseek-v4-flash"],
    anthropic: [],
    openrouter: ["openrouter/auto", "openai/gpt-oss-20b:free"]
  },
  agentModeSupportedProviders: ["deepseek", "openrouter"],
  agentModeModelsByProvider: {
    deepseek: ["deepseek-v4-flash"],
    openrouter: ["openrouter/auto"]
  }
};

test("provider labels use product names", () => {
  assert.equal(providerLabel("anthropic"), "Anthropic Claude");
  assert.equal(providerLabel("copilot"), "GitHub Copilot");
  assert.equal(providerLabel("openrouter"), "OpenRouter");
});

test("provider defaults stay first and allow-lists do not leak across providers", () => {
  const catalog = [
    { provider: "deepseek", tag: "deepseek-v4-pro", type: "code" },
    { provider: "deepseek", tag: "deepseek-v4-flash", type: "text" },
    { provider: "anthropic", tag: "claude-fable-5-1", type: "text" }
  ];
  assert.deepEqual(providerModelOptions({ config, modelCatalog: catalog, provider: "deepseek", chatCapableTypes: chatTypes }), [
    "deepseek-v4-flash"
  ]);
  assert.deepEqual(providerModelOptions({ config, modelCatalog: catalog, provider: "anthropic", chatCapableTypes: chatTypes }), [
    "claude-sonnet-5",
    "claude-fable-5-1"
  ]);

  const restrictedConfig = {
    ...config,
    defaultModelsByProvider: { deepseek: "deepseek-v4-pro" },
    allowedModelsByProvider: { deepseek: ["deepseek-v4-flash"] }
  };
  assert.deepEqual(providerModelOptions({ config: restrictedConfig, modelCatalog: catalog, provider: "deepseek", chatCapableTypes: chatTypes }), [
    "deepseek-v4-flash"
  ]);
});

test("OpenRouter variants with router prefixes and suffixes remain selectable", () => {
  assert.equal(isValidCatalogModelTag("~anthropic/claude-sonnet-latest"), true);
  assert.equal(isValidCatalogModelTag("openai/gpt-oss-20b:free:online"), true);
  assert.equal(isValidCatalogModelTag("invalid model"), false);
  assert.deepEqual(providerModelOptions({ config, modelCatalog: [], provider: "openrouter", chatCapableTypes: chatTypes }), [
    "openrouter/auto",
    "openai/gpt-oss-20b:free"
  ]);
});

test("agent mode is gated to provider models explicitly marked as capable", () => {
  const catalog = [
    { provider: "deepseek", tag: "deepseek-v4-flash", type: "text" },
    { provider: "deepseek", tag: "deepseek-v4-pro", type: "code" }
  ];
  assert.equal(providerSupportsAgentModel(config, "deepseek", "deepseek-v4-flash"), true);
  assert.equal(providerSupportsAgentModel(config, "deepseek", "deepseek-v4-pro"), false);
  assert.equal(providerSupportsAgentModel(config, "anthropic", "claude-sonnet-5"), false);
  assert.deepEqual(providerAgentModelOptions({
    config,
    modelCatalog: catalog,
    provider: "deepseek",
    chatCapableTypes: chatTypes
  }), ["deepseek-v4-flash"]);
});
