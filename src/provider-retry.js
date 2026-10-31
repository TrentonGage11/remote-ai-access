export const DEFAULT_RETRYABLE_PROVIDER_STATUSES = Object.freeze([408, 425, 429, 500, 502, 503, 504, 529]);

export function isRetryableProviderStatus(status, retryableStatuses = DEFAULT_RETRYABLE_PROVIDER_STATUSES) {
  return retryableStatuses.includes(Number(status));
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  const text = String(value || "").trim();
  if (!text) return null;

  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(text);
  if (!Number.isFinite(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

export function providerRetryDelayMs({ attempt, retryAfter, baseDelayMs = 1000, maxDelayMs = 60000, random = Math.random }) {
  const retryAfterMs = parseRetryAfterMs(retryAfter);
  if (retryAfterMs !== null) {
    return Math.min(maxDelayMs, retryAfterMs);
  }
  const boundedAttempt = Math.max(0, Math.min(12, Number(attempt || 0)));
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** boundedAttempt));
  const jitter = 0.8 + (Math.max(0, Math.min(1, Number(random()))) * 0.4);
  return Math.max(0, Math.round(exponential * jitter));
}
