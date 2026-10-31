import test from "node:test";
import assert from "node:assert/strict";

import {
  isRetryableProviderStatus,
  parseRetryAfterMs,
  providerRetryDelayMs
} from "../src/provider-retry.js";

test("classifies transient provider statuses", () => {
  assert.equal(isRetryableProviderStatus(429), true);
  assert.equal(isRetryableProviderStatus(503), true);
  assert.equal(isRetryableProviderStatus(529), true);
  assert.equal(isRetryableProviderStatus(400), false);
  assert.equal(isRetryableProviderStatus(401), false);
});

test("parses Retry-After seconds and dates", () => {
  assert.equal(parseRetryAfterMs("2.5", 0), 2500);
  assert.equal(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:08 GMT", 5000), 3000);
  assert.equal(parseRetryAfterMs("invalid", 0), null);
});

test("uses bounded exponential backoff when Retry-After is absent", () => {
  assert.equal(providerRetryDelayMs({ attempt: 0, baseDelayMs: 1000, random: () => 0.5 }), 1000);
  assert.equal(providerRetryDelayMs({ attempt: 3, baseDelayMs: 1000, random: () => 0.5 }), 8000);
  assert.equal(providerRetryDelayMs({ attempt: 10, baseDelayMs: 1000, maxDelayMs: 60000, random: () => 0.5 }), 60000);
  assert.equal(providerRetryDelayMs({ attempt: 0, retryAfter: "120", maxDelayMs: 60000 }), 60000);
});
