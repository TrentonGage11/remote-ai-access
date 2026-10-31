import path from "node:path";
import fsp from "node:fs/promises";
import { createHash } from "node:crypto";

export const CHAT_ARCHIVE_FORMAT = "remote-ai-server-archive-v1";

export function archiveSubjectKey(subject) {
  return createHash("sha256").update(String(subject || "local")).digest("hex").slice(0, 32);
}

export function archivePathForSubject(root, subject) {
  return path.join(path.resolve(root), `${archiveSubjectKey(subject)}.json`);
}

export function normalizeStoredArchivePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("archive payload must be an object");
  }
  if (payload.encrypted === true) {
    for (const field of ["format", "kdf", "cipher", "salt", "iv", "ciphertext"]) {
      if (typeof payload[field] !== "string" || !payload[field]) {
        throw new Error(`encrypted archive is missing ${field}`);
      }
    }
    return {
      format: CHAT_ARCHIVE_FORMAT,
      encrypted: true,
      sourceFormat: payload.format,
      kdf: payload.kdf,
      iterations: Number(payload.iterations) || 200000,
      cipher: payload.cipher,
      salt: payload.salt,
      iv: payload.iv,
      ciphertext: payload.ciphertext
    };
  }
  if (!Array.isArray(payload.chats)) {
    throw new Error("archive payload must contain chats");
  }
  return { format: CHAT_ARCHIVE_FORMAT, encrypted: false, state: payload };
}

export async function readStoredArchive(root, subject) {
  const filePath = archivePathForSubject(root, subject);
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return { path: filePath, payload: JSON.parse(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeStoredArchive(root, subject, payload) {
  const filePath = archivePathForSubject(root, subject);
  await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(tempPath, filePath);
  return filePath;
}
