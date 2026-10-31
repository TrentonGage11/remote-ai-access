import test from "node:test";
import assert from "node:assert/strict";

import { matchesUnlockCode, normalizeUnlockCode, parseWorkspaceUnlockCodes } from "../src/workspace-unlock-codes.js";

const normalizeWorkspace = (value) => /^[a-z0-9_-]+$/.test(String(value).trim().toLowerCase())
  ? String(value).trim().toLowerCase()
  : null;

test("workspace unlock codes normalize and remain isolated", () => {
  const codes = parseWorkspaceUnlockCodes(" Alpha : `secret 1` , beta:secret2, bad entry", normalizeWorkspace);
  assert.equal(codes.get("alpha"), "secret1");
  assert.equal(codes.get("beta"), "secret2");
  assert.equal(codes.size, 2);
  assert.equal(normalizeUnlockCode(" ` a b ` "), "ab");
});

test("unlock matching accepts exact normalized values only", () => {
  assert.equal(matchesUnlockCode(" `secret 1` ", "secret1"), true);
  assert.equal(matchesUnlockCode("secret2", "secret1"), false);
  assert.equal(matchesUnlockCode("", ""), false);
});