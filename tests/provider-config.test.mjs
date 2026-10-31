import test from "node:test";
import assert from "node:assert/strict";

import {
  firstConfiguredEnv,
  isValidProviderModelName,
  parseProviderModelList,
  resolveProviderApiKey,
  resolveProviderModel,
  selectDefaultProvider
} from "../src/provider-config.js";

test("provider inference keys support deployed aliases without accepting admin keys", () => {
  const env = {
    ANTHROPIC_CLAUDE_API_KEY: "claude-inference",
    ANTHROPIC_CLAUDE_ADMIN_API_KEY: "claude-admin",
    TOGETHER_AI_API_KEY: "together-inference",
    OPEN_ROUTER_API_KEY: "openrouter-inference"
  };

  assert.equal(resolveProviderApiKey("anthropic", env), "claude-inference");
  assert.equal(resolveProviderApiKey("together", env), "together-inference");
  assert.equal(resolveProviderApiKey("openrouter", env), "openrouter-inference");
  assert.equal(resolveProviderApiKey("anthropic", { ANTHROPIC_CLAUDE_ADMIN_API_KEY: "admin-only" }), "");
});

test("canonical environment values take precedence over compatibility aliases", () => {
  assert.equal(firstConfiguredEnv({ PRIMARY: "one", LEGACY: "two" }, ["PRIMARY", "LEGACY"]), "one");
  assert.equal(firstConfiguredEnv({ PRIMARY: "", LEGACY: "two" }, ["PRIMARY", "LEGACY"]), "two");
});

test("provider model parsing and validation supports namespaced router variants", () => {
  assert.deepEqual(parseProviderModelList(" claude-sonnet-5, openai/gpt-oss-20b:free "), [
    "claude-sonnet-5",
    "openai/gpt-oss-20b:free"
  ]);
  assert.equal(isValidProviderModelName("~anthropic/claude-sonnet-latest"), true);
  assert.equal(isValidProviderModelName("openai/gpt-oss-20b:free:online"), true);
  assert.equal(isValidProviderModelName("bad model"), false);
});

test("provider model resolution honors allow-lists and safe defaults", () => {
  const input = {
    defaultModel: "openrouter/auto",
    allowedModels: ["openrouter/auto", "anthropic/claude-sonnet-5"]
  };
  assert.equal(resolveProviderModel({ ...input, requestedModel: "anthropic/claude-sonnet-5" }), "anthropic/claude-sonnet-5");
  assert.equal(resolveProviderModel({ ...input, requestedModel: "openai/gpt-oss-20b:free" }), "openrouter/auto");
  assert.equal(resolveProviderModel({ ...input, requestedModel: "../secrets" }), "openrouter/auto");
  assert.equal(resolveProviderModel({
    requestedModel: "not/allowed",
    defaultModel: "also/not-allowed",
    allowedModels: ["anthropic/claude-sonnet-5"]
  }), "anthropic/claude-sonnet-5");
});

test("default provider selection never advertises an unconfigured OpenAI route", () => {
  assert.equal(selectDefaultProvider(["deepseek", "anthropic"], "anthropic"), "anthropic");
  assert.equal(selectDefaultProvider(["deepseek", "anthropic"], "openai"), "deepseek");
  assert.equal(selectDefaultProvider(["openai", "deepseek"], "missing"), "openai");
});
