const HOUR_MS = 60 * 60 * 1000;
const MAX_EXTENSION_HOURS = 8760;

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function publicShareAnalytics(share, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(String(share?.expiresAt || ""));
  const expiresInMs = Number.isFinite(expiresAtMs) ? expiresAtMs - nowMs : 0;
  return {
    viewCount: nonNegativeInteger(share?.viewCount),
    downloadCount: nonNegativeInteger(share?.downloadCount),
    accessCount: nonNegativeInteger(share?.accessCount),
    lastAccessedAt: share?.lastAccessedAt || null,
    expiresInMs,
    expiryStatus: expiresInMs <= 0 ? "expired" : expiresInMs <= 24 * HOUR_MS ? "urgent" : expiresInMs <= 7 * 24 * HOUR_MS ? "warning" : "active"
  };
}

export function recordShareActivity(share, activity, nowMs = Date.now()) {
  if (!share || (activity !== "view" && activity !== "download")) return share;
  const counter = activity === "view" ? "viewCount" : "downloadCount";
  share[counter] = nonNegativeInteger(share[counter]) + 1;
  share.lastAccessedAt = new Date(nowMs).toISOString();
  return share;
}

export function extendShareExpiration(expiresAt, hours, nowMs = Date.now()) {
  const extensionHours = Number(hours);
  if (!Number.isFinite(extensionHours) || extensionHours < 1 || extensionHours > MAX_EXTENSION_HOURS) {
    throw new Error(`Extension must be between 1 and ${MAX_EXTENSION_HOURS} hours`);
  }
  const currentExpiryMs = Date.parse(String(expiresAt || ""));
  const baseMs = Number.isFinite(currentExpiryMs) ? Math.max(nowMs, currentExpiryMs) : nowMs;
  const nextExpiryMs = baseMs + extensionHours * HOUR_MS;
  const maximumExpiryMs = nowMs + MAX_EXTENSION_HOURS * HOUR_MS;
  if (nextExpiryMs > maximumExpiryMs) throw new Error("Extended expiration cannot exceed one year from now");
  return new Date(nextExpiryMs).toISOString();
}