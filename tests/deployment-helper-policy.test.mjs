import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  makeReleaseId,
  normalizeStaticActivationRequest,
  normalizeStaticRollbackRequest,
  renderStaticApacheVhost,
  staticActivationPaths
} from "../src/deployment-helper-policy.js";

const input = {
  action: "activate-static",
  workspaceCode: "debugging-media",
  releaseId: "release-20260827t120000z-aabbccddeeff",
  manifest: {
    application: "smoke-static",
    hostname: "smoke-static.tg11.org",
    runtime: "static",
    artifactPath: "deploy-smoke",
    healthPath: "/healthz",
    environmentNames: [],
    persistentData: false
  }
};

test("normalizes a static activation and derives fixed paths", () => {
  const request = normalizeStaticActivationRequest(input, { allowedSuffixes: ["tg11.org"] });
  const paths = staticActivationPaths(request, { sandboxRoot: "/sandbox", deployRoot: "/deploy", apacheAvailableRoot: "/available", apacheEnabledRoot: "/enabled" });
  assert.equal(paths.source, path.join(path.resolve("/sandbox"), "debugging-media", "deploy-smoke"));
  assert.equal(paths.release, path.join(path.resolve("/deploy"), "apps", "smoke-static", "releases", "release-20260827t120000z-aabbccddeeff"));
  assert.match(renderStaticApacheVhost(request, paths.current), /Options -Indexes -FollowSymLinks/);
});

test("rejects unsupported or privilege-expanding activation inputs", () => {
  assert.throws(() => normalizeStaticActivationRequest({ ...input, action: "run-command" }, { allowedSuffixes: ["tg11.org"] }), /unsupported/);
  assert.throws(() => normalizeStaticActivationRequest({ ...input, manifest: { ...input.manifest, runtime: "node-service" } }, { allowedSuffixes: ["tg11.org"] }), /static runtime only/);
  assert.throws(() => normalizeStaticActivationRequest({ ...input, manifest: { ...input.manifest, artifactPath: "../escape" } }, { allowedSuffixes: ["tg11.org"] }), /safe relative/);
  assert.throws(() => normalizeStaticActivationRequest({ ...input, manifest: { ...input.manifest, hostname: "bad.example.com" } }, { allowedSuffixes: ["tg11.org"] }), /allow-list/);
  assert.throws(() => normalizeStaticActivationRequest({ ...input, manifest: { ...input.manifest, environmentNames: ["SECRET"] } }, { allowedSuffixes: ["tg11.org"] }), /does not support/);
});

test("release IDs are deterministic and bounded", () => {
  assert.equal(makeReleaseId(new Date("2026-08-27T12:00:00.123Z"), "aabbccddeeff"), "release-20260827t120000z-aabbccddeeff");
});

test("rollback accepts no caller-selected release", () => {
  const request = normalizeStaticRollbackRequest({ ...input, action: "rollback-static", targetRelease: "release-attacker" }, { allowedSuffixes: ["tg11.org"] });
  assert.equal(request.action, "rollback-static");
  assert.equal(Object.hasOwn(request, "targetRelease"), false);
  assert.equal(staticActivationPaths(request, { deployRoot: "/deploy" }).release, null);
});

