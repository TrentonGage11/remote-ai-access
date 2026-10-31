import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

test("only files meeting the chunk threshold use chunked upload", async () => {
  const source = await readFile(new URL("../public/filelab.js", import.meta.url), "utf8");
  const match = source.match(/function partitionUploadsByThreshold\([\s\S]*?\r?\n}\r?\n/);
  assert.ok(match, "File Lab upload planner must remain self-contained");

  const context = {};
  vm.runInNewContext(`${match[0]}; this.partitionUploadsByThreshold = partitionUploadsByThreshold;`, context);
  const files = [
    ...Array.from({ length: 60 }, (_, index) => ({ name: `small-${index}.txt`, size: 1024 })),
    { name: "large.bin", size: 64 * 1024 * 1024 }
  ];

  const result = context.partitionUploadsByThreshold(files, 64 * 1024 * 1024);
  assert.equal(result.directFiles.length, 60);
  assert.equal(result.chunkedFiles.length, 1);
  assert.equal(result.chunkedFiles[0].file.name, "large.bin");
  assert.equal(result.chunkedFiles[0].fileIndex, 60);
});

test("direct uploads are split into Cloudflare-safe byte batches", async () => {
  const source = await readFile(new URL("../public/filelab.js", import.meta.url), "utf8");
  const match = source.match(/function createDirectUploadBatches\([\s\S]*?\r?\n}\r?\n/);
  assert.ok(match, "File Lab direct upload batch planner must remain self-contained");

  const context = {};
  vm.runInNewContext(`${match[0]}; this.createDirectUploadBatches = createDirectUploadBatches;`, context);
  const entries = Array.from({ length: 120 }, (_, fileIndex) => ({
    file: { name: `small-${fileIndex}.bin`, size: 1024 * 1024 },
    fileIndex
  }));

  const batches = context.createDirectUploadBatches(entries, 48 * 1024 * 1024);
  assert.deepEqual(Array.from(batches, (batch) => batch.length), [48, 48, 24]);
  assert.equal(context.createDirectUploadBatches([{ file: { size: 60 * 1024 * 1024 } }], 48 * 1024 * 1024).length, 1);
});