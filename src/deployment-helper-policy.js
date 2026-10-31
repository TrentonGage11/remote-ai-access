import path from "path";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,47}$/;
const RELEASE_PATTERN = /^release-[0-9]{8}t[0-9]{6}z-[a-f0-9]{12}$/;

function requireMatch(value, pattern, label) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function requireRelativePath(value, label) {
  const normalized = String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return normalized;
}

export function normalizeStaticActivationRequest(input = {}, options = {}) {
  if (String(input.action || "") !== "activate-static") throw new Error("unsupported helper action");
  const workspaceCode = requireMatch(input.workspaceCode, WORKSPACE_PATTERN, "workspaceCode");
  const application = requireMatch(input.manifest?.application, SLUG_PATTERN, "application");
  const hostname = String(input.manifest?.hostname || "").trim().toLowerCase();
  const suffixes = (Array.isArray(options.allowedSuffixes) ? options.allowedSuffixes : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (!suffixes.some((suffix) => hostname.endsWith(`.${suffix}`) && hostname !== suffix)) {
    throw new Error("hostname is outside the helper allow-list");
  }
  if (input.manifest?.runtime !== "static") throw new Error("helper supports static runtime only");
  if ((input.manifest?.environmentNames || []).length > 0 || input.manifest?.persistentData) {
    throw new Error("static activation does not support environment names or persistent data");
  }
  const healthPath = String(input.manifest?.healthPath || "").trim();
  if (!healthPath.startsWith("/") || healthPath.startsWith("//") || /[?#\s]/.test(healthPath)) {
    throw new Error("healthPath is invalid");
  }
  return Object.freeze({
    action: "activate-static",
    workspaceCode,
    releaseId: requireMatch(input.releaseId, RELEASE_PATTERN, "releaseId"),
    manifest: Object.freeze({
      application,
      hostname,
      runtime: "static",
      artifactPath: requireRelativePath(input.manifest?.artifactPath, "artifactPath"),
      healthPath
    })
  });
}

export function staticActivationPaths(request, options = {}) {
  const sandboxRoot = path.resolve(options.sandboxRoot || "/opt/remote-ai-access/sandbox/workspaces");
  const deployRoot = path.resolve(options.deployRoot || "/var/lib/raa-deploy");
  const apacheAvailableRoot = path.resolve(options.apacheAvailableRoot || "/etc/apache2/sites-available");
  const apacheEnabledRoot = path.resolve(options.apacheEnabledRoot || "/etc/apache2/sites-enabled");
  const appRoot = path.join(deployRoot, "apps", request.manifest.application);
  return Object.freeze({
    source: path.join(sandboxRoot, request.workspaceCode, request.manifest.artifactPath),
    appRoot,
    release: request.releaseId ? path.join(appRoot, "releases", request.releaseId) : null,
    current: path.join(appRoot, "current"),
    registry: path.join(deployRoot, "registry.json"),
    lock: path.join(deployRoot, "activation.lock"),
    vhostAvailable: path.join(apacheAvailableRoot, `raa-deploy-${request.manifest.application}.conf`),
    vhostEnabled: path.join(apacheEnabledRoot, `raa-deploy-${request.manifest.application}.conf`)
  });
}

export function renderStaticApacheVhost(request, currentPath, options = {}) {
  const certificate = String(options.certificate || "/etc/apache2/ssl/tg11.org.pem");
  const certificateKey = String(options.certificateKey || "/etc/apache2/ssl/tg11.org.key");
  const host = request.manifest.hostname;
  return `<VirtualHost *:80>\n    ServerName ${host}\n    Redirect permanent / https://${host}/\n</VirtualHost>\n\n<VirtualHost *:443>\n    ServerName ${host}\n    DocumentRoot ${currentPath}\n\n    SSLEngine on\n    SSLCertificateFile ${certificate}\n    SSLCertificateKeyFile ${certificateKey}\n\n    <Directory ${currentPath}>\n        Options -Indexes -FollowSymLinks\n        AllowOverride None\n        Require all granted\n    </Directory>\n\n    Header always set X-Content-Type-Options "nosniff"\n    Header always set Referrer-Policy "strict-origin-when-cross-origin"\n    ErrorLog \${APACHE_LOG_DIR}/raa-deploy-${request.manifest.application}-error.log\n    CustomLog \${APACHE_LOG_DIR}/raa-deploy-${request.manifest.application}-access.log combined\n</VirtualHost>\n`;
}

export function makeReleaseId(now = new Date(), entropy = "000000000000") {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").toLowerCase();
  const suffix = String(entropy || "").toLowerCase();
  if (!/^[a-f0-9]{12}$/.test(suffix)) throw new Error("release entropy is invalid");
  return `release-${stamp}-${suffix}`;
}

export function normalizeStaticRollbackRequest(input = {}, options = {}) {
  if (String(input.action || "") !== "rollback-static") throw new Error("unsupported helper action");
  const activation = normalizeStaticActivationRequest({
    ...input,
    action: "activate-static",
    releaseId: "release-20000101t000000z-000000000000"
  }, options);
  return Object.freeze({
    action: "rollback-static",
    workspaceCode: activation.workspaceCode,
    manifest: activation.manifest
  });
}