import { createHash, randomBytes, timingSafeEqual } from "crypto";

const MAX_APPROVAL_TTL_MS = 30 * 60 * 1000;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function deploymentManifestDigest(manifest) {
  return sha256(JSON.stringify(canonicalize(manifest)));
}

export function createDeploymentApproval({ workspaceCode, manifest, action = "activate", ttlMs, nowMs = Date.now() } = {}) {
  const workspace = String(workspaceCode || "").trim().toLowerCase();
  if (!workspace) throw new Error("workspaceCode is required");
  if (!manifest || typeof manifest !== "object") throw new Error("normalized manifest is required");
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!["activate", "rollback"].includes(normalizedAction)) throw new Error("deployment approval action is invalid");
  const lifetimeMs = Math.max(60_000, Math.min(MAX_APPROVAL_TTL_MS, Number(ttlMs || 10 * 60 * 1000)));
  const token = randomBytes(32).toString("base64url");
  const id = `approval-${randomBytes(10).toString("hex")}`;
  return {
    token,
    record: {
      id,
      action: normalizedAction,
      workspaceCode: workspace,
      manifestDigest: deploymentManifestDigest(manifest),
      application: String(manifest.application || ""),
      hostname: String(manifest.hostname || ""),
      tokenHash: sha256(token),
      status: "pending",
      createdAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + lifetimeMs).toISOString(),
      consumedAt: null,
      revokedAt: null
    }
  };
}

export function publicDeploymentApproval(record) {
  if (!record) return null;
  const { tokenHash: _tokenHash, ...visible } = record;
  return visible;
}

export function consumeDeploymentApproval(record, { token, workspaceCode, manifest, action = "activate", nowMs = Date.now() } = {}) {
  if (!record || record.status !== "pending") throw new Error("deployment approval is not pending");
  if (Date.parse(record.expiresAt) <= nowMs) throw new Error("deployment approval has expired");
  if (String(workspaceCode || "").trim().toLowerCase() !== record.workspaceCode) throw new Error("deployment approval belongs to a different workspace");
  if (String(action || "").trim().toLowerCase() !== String(record.action || "activate")) throw new Error("deployment approval does not allow this action");
  if (deploymentManifestDigest(manifest) !== record.manifestDigest) throw new Error("deployment approval does not match this manifest");
  const providedHash = Buffer.from(sha256(String(token || "")), "hex");
  const expectedHash = Buffer.from(String(record.tokenHash || ""), "hex");
  if (providedHash.length !== expectedHash.length || !timingSafeEqual(providedHash, expectedHash)) {
    throw new Error("deployment approval token is invalid");
  }
  return { ...record, status: "consumed", consumedAt: new Date(nowMs).toISOString() };
}

export function beginDeploymentActivation(record, { token, workspaceCode, manifest, action = "activate", nowMs = Date.now() } = {}) {
  const consumed = consumeDeploymentApproval(record, { token, workspaceCode, manifest, action, nowMs });
  return { ...consumed, status: "activating", activatingAt: consumed.consumedAt, consumedAt: null };
}

export function completeDeploymentActivation(record, { releaseId, nowMs = Date.now() } = {}) {
  if (!record || record.status !== "activating") throw new Error("deployment approval is not activating");
  const normalizedReleaseId = String(releaseId || "").trim();
  if (!normalizedReleaseId) throw new Error("releaseId is required");
  return { ...record, status: "consumed", releaseId: normalizedReleaseId, consumedAt: new Date(nowMs).toISOString() };
}

export function failDeploymentActivation(record, { error, nowMs = Date.now() } = {}) {
  if (!record || record.status !== "activating") throw new Error("deployment approval is not activating");
  return {
    ...record,
    status: "failed",
    failedAt: new Date(nowMs).toISOString(),
    failure: String(error || "deployment activation failed").slice(0, 500)
  };
}

export function revokeDeploymentApproval(record, nowMs = Date.now()) {
  if (!record || record.status !== "pending") throw new Error("only pending deployment approvals can be revoked");
  return { ...record, status: "revoked", revokedAt: new Date(nowMs).toISOString() };
}

export { MAX_APPROVAL_TTL_MS };