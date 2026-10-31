import test from "node:test";
import assert from "node:assert/strict";

import {
  createBasicAuthSession,
  normalizeBasicAuthReturnPath,
  verifyBasicAuthSession
} from "../src/basic-auth-session.js";

test("creates a signed expiring session for one configured user", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  const token = createBasicAuthSession({ username: "admin", secret: "session-secret", ttlMs: 60_000, nowMs });
  assert.equal(verifyBasicAuthSession(token, { username: "admin", secret: "session-secret", nowMs }), true);
  assert.equal(verifyBasicAuthSession(token, { username: "other", secret: "session-secret", nowMs }), false);
  assert.equal(verifyBasicAuthSession(token, { username: "admin", secret: "wrong", nowMs }), false);
  assert.equal(verifyBasicAuthSession(token, { username: "admin", secret: "session-secret", nowMs: nowMs + 60_001 }), false);
  assert.equal(verifyBasicAuthSession(`${token}x`, { username: "admin", secret: "session-secret", nowMs }), false);
});

test("return paths remain local and cannot loop through login", () => {
  assert.equal(normalizeBasicAuthReturnPath("/filelab.html?path=src"), "/filelab.html?path=src");
  assert.equal(normalizeBasicAuthReturnPath('/filelab.html?path="src"'), '/filelab.html?path="src"');
  assert.equal(normalizeBasicAuthReturnPath("https://evil.example"), "/");
  assert.equal(normalizeBasicAuthReturnPath("//evil.example"), "/");
  assert.equal(normalizeBasicAuthReturnPath("/basic-auth?next=/"), "/");
});