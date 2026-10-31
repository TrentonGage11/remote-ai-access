import { createHmac, timingSafeEqual } from "node:crypto";

export const BASIC_AUTH_SESSION_COOKIE = "raa_basic_session";

function signature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createBasicAuthSession({ username, secret, ttlMs, nowMs = Date.now() } = {}) {
  const subject = String(username || "").trim();
  const signingSecret = String(secret || "");
  if (!subject || !signingSecret) throw new Error("basic auth session configuration is incomplete");
  const lifetimeMs = Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Number(ttlMs || 12 * 60 * 60 * 1000)));
  const payload = Buffer.from(JSON.stringify({ sub: subject, exp: nowMs + lifetimeMs }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, signingSecret)}`;
}

export function verifyBasicAuthSession(token, { username, secret, nowMs = Date.now() } = {}) {
  const [payload, providedSignature, extra] = String(token || "").split(".");
  if (!payload || !providedSignature || extra) return false;
  const expectedSignature = signature(payload, String(secret || ""));
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value?.sub === String(username || "").trim()
      && Number.isFinite(value?.exp)
      && value.exp > nowMs;
  } catch {
    return false;
  }
}

export function normalizeBasicAuthReturnPath(value) {
  const candidate = String(value || "/").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\r\n]/.test(candidate)) return "/";
  return candidate.startsWith("/basic-auth") ? "/" : candidate;
}