import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, X509Certificate } from "node:crypto";
import {
  normalizeStaticActivationRequest,
  normalizeStaticRollbackRequest,
  renderStaticApacheVhost,
  staticActivationPaths
} from "./deployment-helper-policy.js";

const execFileAsync = promisify(execFile);
const socketPath = process.env.RAA_DEPLOY_SOCKET || "/run/raa-deploy/helper.sock";
const allowedSuffixes = String(process.env.RAA_DEPLOY_ALLOWED_SUFFIXES || "tg11.org").split(",").map((value) => value.trim()).filter(Boolean);
const pathOptions = {
  sandboxRoot: process.env.RAA_DEPLOY_SANDBOX_ROOT || "/opt/remote-ai-access/sandbox/workspaces",
  deployRoot: process.env.RAA_DEPLOY_ROOT || "/var/lib/raa-deploy",
  apacheAvailableRoot: process.env.RAA_DEPLOY_APACHE_AVAILABLE || "/etc/apache2/sites-available",
  apacheEnabledRoot: process.env.RAA_DEPLOY_APACHE_ENABLED || "/etc/apache2/sites-enabled"
};
const apacheCtl = process.env.RAA_DEPLOY_APACHECTL || "/usr/sbin/apache2ctl";
const systemctl = process.env.RAA_DEPLOY_SYSTEMCTL || "/usr/bin/systemctl";
const curl = process.env.RAA_DEPLOY_CURL || "/usr/bin/curl";
const tlsCertificate = process.env.RAA_DEPLOY_TLS_CERTIFICATE || "/etc/apache2/ssl/tg11.org.pem";
const tlsCertificateKey = process.env.RAA_DEPLOY_TLS_CERTIFICATE_KEY || "/etc/apache2/ssl/tg11.org.key";
const tlsPublicKeyPin = `sha256//${createHash("sha256").update(new X509Certificate(await fsp.readFile(tlsCertificate)).publicKey.export({ type: "spki", format: "der" })).digest("base64")}`;
const maxFiles = 10_000;
const maxBytes = 512 * 1024 * 1024;
const releasePattern = /^release-[0-9]{8}t[0-9]{6}z-[a-f0-9]{12}$/;

async function atomicWrite(filePath, content, mode = 0o600) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, content, { encoding: "utf8", mode });
  await fsp.rename(temporary, filePath);
}

async function inspectArtifact(root) {
  const rootReal = await fsp.realpath(root);
  const stack = [rootReal];
  let files = 0;
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const stat = await fsp.lstat(target);
      if (stat.isSymbolicLink()) throw new Error("deployment artifacts cannot contain symbolic links");
      if (stat.isDirectory()) stack.push(target);
      else if (stat.isFile()) {
        files += 1;
        bytes += stat.size;
      } else throw new Error("deployment artifacts may contain regular files and directories only");
      if (files > maxFiles || bytes > maxBytes) throw new Error("deployment artifact exceeds helper limits");
    }
  }
  return { rootReal, files, bytes };
}

async function chmodStaticTree(root) {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    await fsp.chmod(current, 0o755);
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else await fsp.chmod(target, 0o644);
    }
  }
}

async function assertNoHostnameConflict(request, ownVhost) {
  const entries = await fsp.readdir(pathOptions.apacheAvailableRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".conf")) continue;
    const candidate = path.join(pathOptions.apacheAvailableRoot, entry.name);
    if (candidate === ownVhost) continue;
    const content = await fsp.readFile(candidate, "utf8").catch(() => "");
    const ownsHostname = content.split(/\r?\n/).some((line) => {
      const fields = line.trim().split(/\s+/);
      return ["servername", "serveralias"].includes(String(fields[0] || "").toLowerCase())
        && fields.slice(1).map((value) => value.toLowerCase()).includes(request.manifest.hostname);
    });
    if (ownsHostname) {
      throw new Error("hostname is already owned by another Apache vhost");
    }
  }
}

async function readRegistry(registryPath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(registryPath, "utf8"));
    return { version: 1, applications: parsed?.applications && typeof parsed.applications === "object" ? parsed.applications : {} };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, applications: {} };
    throw error;
  }
}

async function restoreActivation(paths, state) {
  if (state.previousCurrent) {
    const temporary = `${paths.current}.restore-${process.pid}`;
    await fsp.symlink(state.previousCurrent, temporary);
    await fsp.rename(temporary, paths.current);
  } else {
    await fsp.rm(paths.current, { force: true });
  }
  if (state.previousVhost == null) await fsp.rm(paths.vhostAvailable, { force: true });
  else await atomicWrite(paths.vhostAvailable, state.previousVhost, 0o644);
  if (!state.wasEnabled) await fsp.rm(paths.vhostEnabled, { force: true });
  await execFileAsync(apacheCtl, ["configtest"]);
  await execFileAsync(systemctl, ["reload", "apache2"]);
}

async function activateStatic(rawRequest) {
  const request = normalizeStaticActivationRequest(rawRequest, { allowedSuffixes });
  const paths = staticActivationPaths(request, pathOptions);
  await fsp.mkdir(pathOptions.deployRoot, { recursive: true, mode: 0o755 });
  await fsp.chmod(pathOptions.deployRoot, 0o755);
  try {
    await fsp.mkdir(paths.lock);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("another deployment activation is in progress");
    throw error;
  }
  let releaseCreated = false;
  let activationStarted = false;
  const state = {
    previousCurrent: await fsp.readlink(paths.current).catch(() => null),
    previousVhost: await fsp.readFile(paths.vhostAvailable, "utf8").catch(() => null),
    wasEnabled: fs.existsSync(paths.vhostEnabled)
  };
  try {
    const expectedWorkspace = path.resolve(pathOptions.sandboxRoot, request.workspaceCode);
    const artifact = await inspectArtifact(paths.source);
    if (artifact.rootReal !== expectedWorkspace && !artifact.rootReal.startsWith(`${expectedWorkspace}${path.sep}`)) {
      throw new Error("artifact resolves outside its workspace");
    }
    const indexPath = path.join(artifact.rootReal, "index.html");
    const healthRelative = request.manifest.healthPath === "/" ? "index.html" : request.manifest.healthPath.slice(1);
    const healthPath = path.resolve(artifact.rootReal, healthRelative);
    if (!healthPath.startsWith(`${artifact.rootReal}${path.sep}`)) throw new Error("healthPath escapes the artifact");
    if (!(await fsp.stat(indexPath).catch(() => null))?.isFile()) throw new Error("static artifact requires index.html");
    if (!(await fsp.stat(healthPath).catch(() => null))?.isFile()) throw new Error("healthPath must reference an existing static file");
    await assertNoHostnameConflict(request, paths.vhostAvailable);
    if (fs.existsSync(paths.release)) throw new Error("release already exists");
    await fsp.mkdir(path.dirname(paths.release), { recursive: true, mode: 0o755 });
    await fsp.cp(artifact.rootReal, paths.release, { recursive: true, errorOnExist: true, force: false, dereference: false });
    releaseCreated = true;
    await inspectArtifact(paths.release);
    await chmodStaticTree(paths.release);
    const temporaryCurrent = `${paths.current}.next-${process.pid}`;
    await fsp.symlink(paths.release, temporaryCurrent);
    await fsp.rename(temporaryCurrent, paths.current);
    await atomicWrite(paths.vhostAvailable, renderStaticApacheVhost(request, paths.current, {
      certificate: tlsCertificate,
      certificateKey: tlsCertificateKey
    }), 0o644);
    if (!fs.existsSync(paths.vhostEnabled)) await fsp.symlink(paths.vhostAvailable, paths.vhostEnabled);
    activationStarted = true;
    await execFileAsync(apacheCtl, ["configtest"]);
    await execFileAsync(systemctl, ["reload", "apache2"]);
    await execFileAsync(curl, ["--fail", "--silent", "--show-error", "--max-time", "10", "--insecure", "--pinnedpubkey", tlsPublicKeyPin, "--resolve", `${request.manifest.hostname}:443:127.0.0.1`, `https://${request.manifest.hostname}${request.manifest.healthPath}`]);
    const registry = await readRegistry(paths.registry);
    const previous = registry.applications[request.manifest.application] || null;
    registry.applications[request.manifest.application] = {
      application: request.manifest.application,
      hostname: request.manifest.hostname,
      workspaceCode: request.workspaceCode,
      runtime: "static",
      currentRelease: request.releaseId,
      previousRelease: previous?.currentRelease || null,
      releases: [...new Set([...(previous?.releases || []), request.releaseId])].slice(-20),
      activatedAt: new Date().toISOString()
    };
    await atomicWrite(paths.registry, `${JSON.stringify(registry, null, 2)}\n`, 0o600);
    return { ok: true, action: request.action, application: request.manifest.application, hostname: request.manifest.hostname, releaseId: request.releaseId, files: artifact.files, bytes: artifact.bytes, health: "passed" };
  } catch (error) {
    if (activationStarted) await restoreActivation(paths, state).catch(() => {});
    if (releaseCreated) await fsp.rm(paths.release, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    await fsp.rmdir(paths.lock).catch(() => {});
  }
}

async function rollbackStatic(rawRequest) {
  const request = normalizeStaticRollbackRequest(rawRequest, { allowedSuffixes });
  const paths = staticActivationPaths(request, pathOptions);
  try {
    await fsp.mkdir(paths.lock);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("another deployment activation is in progress");
    throw error;
  }
  const state = {
    previousCurrent: await fsp.readlink(paths.current).catch(() => null),
    previousVhost: await fsp.readFile(paths.vhostAvailable, "utf8").catch(() => null),
    wasEnabled: fs.existsSync(paths.vhostEnabled)
  };
  let activationStarted = false;
  try {
    const registry = await readRegistry(paths.registry);
    const registered = registry.applications[request.manifest.application];
    if (!registered) throw new Error("application is not registered");
    if (registered.hostname !== request.manifest.hostname || registered.workspaceCode !== request.workspaceCode) {
      throw new Error("rollback request does not match the registered application");
    }
    const targetRelease = String(registered.previousRelease || "");
    const currentRelease = String(registered.currentRelease || "");
    if (!releasePattern.test(targetRelease) || !releasePattern.test(currentRelease) || targetRelease === currentRelease) {
      throw new Error("no previous static release is available");
    }
    const targetPath = path.join(paths.appRoot, "releases", targetRelease);
    if (!(await fsp.stat(targetPath).catch(() => null))?.isDirectory()) throw new Error("previous static release is missing");
    await inspectArtifact(targetPath);
    const temporaryCurrent = `${paths.current}.rollback-${process.pid}`;
    await fsp.symlink(targetPath, temporaryCurrent);
    await fsp.rename(temporaryCurrent, paths.current);
    await atomicWrite(paths.vhostAvailable, renderStaticApacheVhost(request, paths.current, {
      certificate: tlsCertificate,
      certificateKey: tlsCertificateKey
    }), 0o644);
    if (!fs.existsSync(paths.vhostEnabled)) await fsp.symlink(paths.vhostAvailable, paths.vhostEnabled);
    activationStarted = true;
    await execFileAsync(apacheCtl, ["configtest"]);
    await execFileAsync(systemctl, ["reload", "apache2"]);
    await execFileAsync(curl, ["--fail", "--silent", "--show-error", "--max-time", "10", "--insecure", "--pinnedpubkey", tlsPublicKeyPin, "--resolve", `${request.manifest.hostname}:443:127.0.0.1`, `https://${request.manifest.hostname}${request.manifest.healthPath}`]);
    registry.applications[request.manifest.application] = {
      ...registered,
      currentRelease: targetRelease,
      previousRelease: currentRelease,
      activatedAt: new Date().toISOString(),
      lastAction: "rollback"
    };
    await atomicWrite(paths.registry, `${JSON.stringify(registry, null, 2)}\n`, 0o600);
    return { ok: true, action: request.action, application: request.manifest.application, hostname: request.manifest.hostname, releaseId: targetRelease, rolledBackFrom: currentRelease, health: "passed" };
  } catch (error) {
    if (activationStarted) await restoreActivation(paths, state).catch(() => {});
    throw error;
  } finally {
    await fsp.rmdir(paths.lock).catch(() => {});
  }
}

async function handleSocket(socket) {
  let body = "";
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    body += chunk;
    if (body.length > 64 * 1024) socket.destroy(new Error("request is too large"));
  });
  socket.on("end", async () => {
    try {
      const request = JSON.parse(body);
      const result = request?.action === "rollback-static"
        ? await rollbackStatic(request)
        : await activateStatic(request);
      socket.end(`${JSON.stringify(result)}\n`);
    } catch (error) {
      socket.end(`${JSON.stringify({ ok: false, error: String(error?.message || error).slice(0, 1000) })}\n`);
    }
  });
}

const server = net.createServer({ allowHalfOpen: true }, handleSocket);
const inheritedSocket = Number(process.env.LISTEN_PID) === process.pid && Number(process.env.LISTEN_FDS) >= 1;
if (inheritedSocket) {
  server.listen({ fd: 3 });
} else {
  await fsp.mkdir(path.dirname(socketPath), { recursive: true });
  await fsp.rm(socketPath, { force: true });
  server.listen(socketPath, () => fs.chmodSync(socketPath, 0o660));
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}