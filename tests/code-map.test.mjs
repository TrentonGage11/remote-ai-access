import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { buildCodeMap, codeMapSummary, selectRelevantCodeMapEntries } from "../src/code-map.js";

test("buildCodeMap indexes symbols and imports while ignoring dependency folders", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "raa-code-map-"));
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
  await fsp.writeFile(path.join(root, "src", "app.js"), "import x from 'pkg';\nexport function greet() {}\nclass Widget {}\n");
  await fsp.writeFile(path.join(root, "node_modules", "ignored", "bad.js"), "function shouldNotAppear() {}\n");
  const map = await buildCodeMap(root);
  assert.equal(map.fileCount, 1);
  assert.deepEqual(map.files[0].imports[0].source, "pkg");
  assert.deepEqual(map.files[0].symbols.map((item) => item.name), ["greet", "Widget"]);
  assert.deepEqual(codeMapSummary(map), { version: 1, generatedAt: map.generatedAt, fileCount: 1, symbolCount: 2, importCount: 1, skippedCount: 0 });
});

test("buildCodeMap uses a bounded extension-aware scan", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "raa-code-map-"));
  await fsp.writeFile(path.join(root, "notes.txt"), "function invisible() {}\n");
  await fsp.writeFile(path.join(root, "main.py"), "from os import path\ndef run():\n    return path\n");
  const map = await buildCodeMap(root, { maxFiles: 1 });
  assert.equal(map.fileCount, 1);
  assert.equal(map.files[0].path, "main.py");
  assert.equal(map.files[0].symbols[0].name, "run");
});

test("selectRelevantCodeMapEntries ranks task-matching symbols and paths", () => {
  const map = {
    files: [
      { path: "src/auth.js", symbols: [{ kind: "function", name: "login", line: 1 }], imports: [{ source: "./session.js", line: 2 }] },
      { path: "src/queue.js", symbols: [{ kind: "function", name: "enqueue", line: 1 }], imports: [] }
    ]
  };
  const result = selectRelevantCodeMapEntries(map, "fix auth login", 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, "src/auth.js");
});
