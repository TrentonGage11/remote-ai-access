import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import {
  applyWorkspaceReplacements,
  previewWorkspaceReplacements,
  searchWorkspaceFiles
} from "../src/workspace-search.js";

async function withWorkspace(run) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "workspace-search-"));
  try {
    await fsp.mkdir(path.join(root, "src"));
    await fsp.writeFile(path.join(root, "src", "alpha.js"), "first line\nconst targetValue = 1;\n", "utf8");
    await fsp.writeFile(path.join(root, "notes.txt"), "Target value in notes\n", "utf8");
    await fsp.writeFile(path.join(root, ".audit-log.jsonl"), "targetValue should remain internal\n", "utf8");
    await run(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("search supports filename, text, hybrid, and regex with locations", async () => withWorkspace(async (root) => {
  const filename = await searchWorkspaceFiles(root, root, { query: "alpha", mode: "filename" });
  assert.equal(filename.results[0].path, "src/alpha.js");

  const text = await searchWorkspaceFiles(root, root, { query: "targetValue", mode: "text" });
  assert.equal(text.results[0].path, "src/alpha.js");
  assert.deepEqual({ line: text.results[0].line, column: text.results[0].column }, { line: 2, column: 7 });

  const hybrid = await searchWorkspaceFiles(root, root, { query: "target", mode: "hybrid" });
  assert.equal(hybrid.resultCount, 2);

  const regex = await searchWorkspaceFiles(root, root, { query: "target(Value| value)", mode: "regex" });
  assert.equal(regex.resultCount, 2);

  const caseSensitive = await searchWorkspaceFiles(root, root, { query: "Target", mode: "text", caseSensitive: true });
  assert.deepEqual(caseSensitive.results.map((item) => item.path), ["notes.txt"]);
}));

test("replacement preview does not write and apply changes only accepted files", async () => withWorkspace(async (root) => {
  const args = { query: "target", replacement: "chosen", caseSensitive: false };
  const preview = await previewWorkspaceReplacements(root, root, args);
  assert.equal(preview.filesMatched, 2);
  assert.match(await fsp.readFile(path.join(root, "notes.txt"), "utf8"), /Target/);

  const applied = await applyWorkspaceReplacements(root, root, ["notes.txt"], args);
  assert.deepEqual(applied.changedFiles, ["notes.txt"]);
  assert.match(await fsp.readFile(path.join(root, "notes.txt"), "utf8"), /chosen/i);
  assert.match(await fsp.readFile(path.join(root, "src", "alpha.js"), "utf8"), /targetValue/);
}));