import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { summarizeDirectoryContents } from "../src/directory-summary.js";

function directory(name) {
  return { name, isDirectory: () => true, isFile: () => false };
}

function file(name) {
  return { name, isDirectory: () => false, isFile: () => true };
}

test("skips inaccessible transient descendants while preserving accessible totals", async () => {
  const root = path.resolve("workspace");
  const cache = path.join(root, ".cache");
  const denied = path.join(cache, "tmp.hash");
  const fsOps = {
    async readdir(target) {
      if (target === root) return [file("readme.md"), directory(".cache")];
      if (target === cache) return [file("index.json"), directory("tmp.hash")];
      if (target === denied) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      throw new Error(`unexpected path: ${target}`);
    },
    async stat(target) {
      if (target === path.join(root, "readme.md")) return { size: 10 };
      if (target === path.join(cache, "index.json")) return { size: 5 };
      throw new Error(`unexpected path: ${target}`);
    }
  };

  assert.deepEqual(await summarizeDirectoryContents(root, fsOps), {
    size: 15,
    fileCount: 2,
    directoryCount: 2,
    skippedCount: 1
  });
});

test("does not hide unexpected traversal failures", async () => {
  const failure = Object.assign(new Error("I/O failed"), { code: "EIO" });
  await assert.rejects(
    summarizeDirectoryContents("workspace", { readdir: async () => { throw failure; } }),
    failure
  );
});