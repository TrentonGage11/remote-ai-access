import test from "node:test";
import assert from "node:assert/strict";

import {
  beginDeploymentActivation,
  completeDeploymentActivation,
  consumeDeploymentApproval,
  createDeploymentApproval,
  deploymentManifestDigest,
  failDeploymentActivation,
  publicDeploymentApproval,
  revokeDeploymentApproval
} from "../src/deployment-approval.js";

const manifest = { version: 1, application: "sample-app", hostname: "sample.tg11.org", resources: { memoryMb: 256 } };

test("manifest digest is stable across object key order", () => {
  assert.equal(deploymentManifestDigest(manifest), deploymentManifestDigest({
    resources: { memoryMb: 256 }, hostname: "sample.tg11.org", application: "sample-app", version: 1
  }));
});

test("approval is hashed, exact-manifest bound, and single-use", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  const created = createDeploymentApproval({ workspaceCode: "alpha", manifest, nowMs });
  assert.notEqual(created.record.tokenHash, created.token);
  assert.equal(Object.hasOwn(publicDeploymentApproval(created.record), "tokenHash"), false);
  assert.throws(() => consumeDeploymentApproval(created.record, {
    token: created.token, workspaceCode: "alpha", manifest: { ...manifest, hostname: "other.tg11.org" }, nowMs
  }), /does not match/);
  const consumed = consumeDeploymentApproval(created.record, { token: created.token, workspaceCode: "alpha", manifest, nowMs });
  assert.equal(consumed.status, "consumed");
  assert.throws(() => consumeDeploymentApproval(consumed, { token: created.token, workspaceCode: "alpha", manifest, nowMs }), /not pending/);
});

test("approval rejects wrong workspace, token, expiry, and revoked records", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  const created = createDeploymentApproval({ workspaceCode: "alpha", manifest, ttlMs: 60_000, nowMs });
  assert.throws(() => consumeDeploymentApproval(created.record, { token: created.token, workspaceCode: "beta", manifest, nowMs }), /different workspace/);
  assert.throws(() => consumeDeploymentApproval(created.record, { token: "wrong", workspaceCode: "alpha", manifest, nowMs }), /invalid/);
  assert.throws(() => consumeDeploymentApproval(created.record, { token: created.token, workspaceCode: "alpha", manifest, nowMs: nowMs + 60_001 }), /expired/);
  const revoked = revokeDeploymentApproval(created.record, nowMs);
  assert.equal(revoked.status, "revoked");
  assert.throws(() => consumeDeploymentApproval(revoked, { token: created.token, workspaceCode: "alpha", manifest, nowMs }), /not pending/);
});

test("activation transitions fail closed and cannot replay a token", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  const created = createDeploymentApproval({ workspaceCode: "alpha", manifest, nowMs });
  const activating = beginDeploymentActivation(created.record, { token: created.token, workspaceCode: "alpha", manifest, nowMs });
  assert.equal(activating.status, "activating");
  assert.throws(() => beginDeploymentActivation(activating, { token: created.token, workspaceCode: "alpha", manifest, nowMs }), /not pending/);
  const completed = completeDeploymentActivation(activating, { releaseId: "release-1", nowMs });
  assert.equal(completed.status, "consumed");
  assert.equal(completed.releaseId, "release-1");
  const failed = failDeploymentActivation(activating, { error: "health check failed", nowMs });
  assert.equal(failed.status, "failed");
  assert.match(failed.failure, /health check/);
});

test("approval tokens are bound to activate or rollback", () => {
  const nowMs = Date.parse("2026-08-27T00:00:00.000Z");
  const created = createDeploymentApproval({ workspaceCode: "alpha", manifest, action: "rollback", nowMs });
  assert.equal(created.record.action, "rollback");
  assert.throws(() => beginDeploymentActivation(created.record, { token: created.token, workspaceCode: "alpha", manifest, action: "activate", nowMs }), /does not allow/);
  const activating = beginDeploymentActivation(created.record, { token: created.token, workspaceCode: "alpha", manifest, action: "rollback", nowMs });
  assert.equal(activating.status, "activating");
});