import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  archivePathForSubject,
  normalizeStoredArchivePayload,
  readStoredArchive,
  writeStoredArchive
} from "../src/chat-archive-store.js";

test("server archive storage isolates subjects and round-trips encrypted payloads", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "raa-chat-archive-"));
  const payload = normalizeStoredArchivePayload({
    format: "remote-ai-archive-v1",
    encrypted: true,
    kdf: "PBKDF2-SHA256",
    iterations: 200000,
    cipher: "AES-GCM-256",
    salt: "salt",
    iv: "iv",
    ciphertext: "ciphertext"
  });
  await writeStoredArchive(root, "alice", payload);
  const found = await readStoredArchive(root, "alice");
  assert.deepEqual(found.payload, payload);
  assert.notEqual(archivePathForSubject(root, "alice"), archivePathForSubject(root, "bob"));
  assert.equal(await readStoredArchive(root, "bob"), null);
  await fsp.rm(root, { recursive: true, force: true });
});

test("server archive storage rejects malformed payloads", () => {
  assert.throws(() => normalizeStoredArchivePayload({ encrypted: true }), /missing format/);
  assert.throws(() => normalizeStoredArchivePayload({}), /contain chats/);
});
