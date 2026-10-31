const APPLICATION_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
const SUPPORTED_RUNTIMES = Object.freeze(["static", "node-service"]);

function requireString(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function normalizeRelativePath(value, label) {
  const normalized = requireString(value, label).replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized) || normalized.includes("\0")) {
    throw new Error(`${label} must be a workspace-relative path`);
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} contains an invalid path segment`);
  }
  return normalized;
}

function normalizeSuffixes(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, ""))
    .filter(Boolean))];
}

function normalizeHostname(value, allowedSuffixes) {
  const hostname = requireString(value, "hostname").toLowerCase().replace(/\.$/, "");
  if (hostname.length > 253 || !/^[a-z0-9.-]+$/.test(hostname) || hostname.split(".").some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) {
    throw new Error("hostname is invalid");
  }
  const suffix = allowedSuffixes.find((candidate) => hostname.endsWith(`.${candidate}`) && hostname !== candidate);
  if (!suffix) throw new Error("hostname is outside the deployment suffix allow-list");
  return hostname;
}

function normalizeHealthPath(value) {
  const healthPath = String(value || "/healthz").trim();
  if (!healthPath.startsWith("/") || healthPath.startsWith("//") || /[?#\s]/.test(healthPath)) {
    throw new Error("healthPath must be a local absolute URL path without a query or fragment");
  }
  return healthPath;
}

function normalizeEnvironmentNames(values, allowedValues) {
  const names = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()))];
  if (names.length > 32 || names.some((name) => !ENVIRONMENT_NAME_PATTERN.test(name))) {
    throw new Error("environmentNames must contain at most 32 uppercase environment variable names");
  }
  const allowed = new Set((Array.isArray(allowedValues) ? allowedValues : []).map((value) => String(value || "").trim()));
  if (names.some((name) => !allowed.has(name))) {
    throw new Error("environmentNames contains a name outside the deployment allow-list");
  }
  return names;
}

function normalizeInteger(value, fallback, minimum, maximum, label) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return normalized;
}

export function normalizeDeploymentManifest(input = {}, options = {}) {
  const allowedSuffixes = normalizeSuffixes(options.allowedSuffixes);
  if (allowedSuffixes.length === 0) throw new Error("deployment is disabled because no hostname suffixes are configured");

  const application = requireString(input.application, "application").toLowerCase();
  if (!APPLICATION_PATTERN.test(application)) throw new Error("application must be a 3-48 character lowercase slug");
  const runtime = String(input.runtime || "").trim().toLowerCase();
  const allowedRuntimes = (Array.isArray(options.allowedRuntimes) && options.allowedRuntimes.length > 0)
    ? options.allowedRuntimes.filter((value) => SUPPORTED_RUNTIMES.includes(value))
    : SUPPORTED_RUNTIMES;
  if (!allowedRuntimes.includes(runtime)) throw new Error("runtime is outside the deployment runtime allow-list");

  const entrypoint = input.entrypoint == null || input.entrypoint === ""
    ? null
    : normalizeRelativePath(input.entrypoint, "entrypoint");
  if (runtime === "node-service" && !entrypoint) throw new Error("entrypoint is required for node-service deployments");
  if (runtime === "static" && entrypoint) throw new Error("entrypoint is not allowed for static deployments");

  return Object.freeze({
    version: 1,
    application,
    hostname: normalizeHostname(input.hostname, allowedSuffixes),
    runtime,
    artifactPath: normalizeRelativePath(input.artifactPath, "artifactPath"),
    entrypoint,
    healthPath: normalizeHealthPath(input.healthPath),
    environmentNames: Object.freeze(normalizeEnvironmentNames(input.environmentNames, options.allowedEnvironmentNames)),
    persistentData: Boolean(input.persistentData),
    resources: Object.freeze({
      memoryMb: normalizeInteger(input.resources?.memoryMb, 256, 64, 2048, "resources.memoryMb"),
      cpuQuotaPercent: normalizeInteger(input.resources?.cpuQuotaPercent, 50, 10, 200, "resources.cpuQuotaPercent"),
      processLimit: normalizeInteger(input.resources?.processLimit, 64, 16, 256, "resources.processLimit")
    })
  });
}

export function previewDeployment(input = {}, options = {}) {
  const manifest = normalizeDeploymentManifest(input, options);
  const port = normalizeInteger(options.port, 0, 1024, 65535, "allocated port");
  return {
    ok: true,
    dryRun: true,
    manifest,
    plan: Object.freeze({
      release: `archive workspace artifact '${manifest.artifactPath}'`,
      runtime: manifest.runtime === "static"
        ? "serve immutable static release on loopback"
        : `start Node entrypoint '${manifest.entrypoint}' on 127.0.0.1:${port}`,
      healthCheck: `http://127.0.0.1:${port}${manifest.healthPath}`,
      publicEndpoint: `https://${manifest.hostname}`,
      activation: "requires a separate one-time approval and privileged helper"
    })
  };
}

export { SUPPORTED_RUNTIMES };