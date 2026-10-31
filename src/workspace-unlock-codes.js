import { timingSafeEqual } from "node:crypto";

export function normalizeUnlockCode(value) {
  let normalized = String(value || "");
  try {
    normalized = normalized.normalize("NFKC");
  } catch {
    // Continue with the raw value when Unicode normalization is unavailable.
  }
  normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (normalized.length >= 2 && normalized.startsWith("`") && normalized.endsWith("`")) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized.replace(/\s+/g, "");
}

export function parseWorkspaceUnlockCodes(rawValue, normalizeWorkspace) {
  const codes = new Map();
  for (const entry of String(rawValue || "").split(",")) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;
    const workspace = normalizeWorkspace(entry.slice(0, separator));
    const code = normalizeUnlockCode(entry.slice(separator + 1));
    if (workspace && code) codes.set(workspace, code);
  }
  return codes;
}

export function matchesUnlockCode(providedValue, expectedValue) {
  const provided = Buffer.from(normalizeUnlockCode(providedValue));
  const expected = Buffer.from(normalizeUnlockCode(expectedValue));
  return provided.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
}