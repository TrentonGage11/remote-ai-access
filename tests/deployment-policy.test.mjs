import test from "node:test";
import assert from "node:assert/strict";

import { normalizeDeploymentManifest, previewDeployment } from "../src/deployment-policy.js";

const options = { allowedSuffixes: ["tg11.org"], allowedEnvironmentNames: ["DATABASE_URL"], port: 8910 };

test("normalizes a bounded node service deployment preview", () => {
  const result = previewDeployment({
    application: "sample-app",
    hostname: "sample.tg11.org",
    runtime: "node-service",
    artifactPath: "apps/sample/dist",
    entrypoint: "server.js",
    healthPath: "/healthz",
    environmentNames: ["DATABASE_URL", "DATABASE_URL"],
    persistentData: true,
    resources: { memoryMb: 512, cpuQuotaPercent: 75, processLimit: 80 }
  }, options);

  assert.equal(result.dryRun, true);
  assert.equal(result.manifest.hostname, "sample.tg11.org");
  assert.deepEqual(result.manifest.environmentNames, ["DATABASE_URL"]);
  assert.equal(result.plan.healthCheck, "http://127.0.0.1:8910/healthz");
  assert.match(result.plan.activation, /approval/);
});

test("rejects manifests outside deployment boundaries", () => {
  assert.throws(() => normalizeDeploymentManifest({
    application: "sample-app",
    hostname: "sample.example.com",
    runtime: "node-service",
    artifactPath: "../outside",
    entrypoint: "server.js"
  }, options), /suffix allow-list/);

  assert.throws(() => normalizeDeploymentManifest({
    application: "sample-app",
    hostname: "sample.tg11.org",
    runtime: "node-service",
    artifactPath: "../outside",
    entrypoint: "server.js"
  }, options), /invalid path segment/);

  assert.throws(() => normalizeDeploymentManifest({
    application: "sample-app",
    hostname: "sample.tg11.org",
    runtime: "shell",
    artifactPath: "dist"
  }, options), /runtime allow-list/);

  assert.throws(() => normalizeDeploymentManifest({
    application: "sample-app",
    hostname: "sample.tg11.org",
    runtime: "static",
    artifactPath: "dist",
    environmentNames: ["UNAPPROVED_SECRET"]
  }, options), /environmentNames.*allow-list/);
});

test("deployment is fail-closed without configured suffixes", () => {
  assert.throws(() => normalizeDeploymentManifest({}), /deployment is disabled/);
});