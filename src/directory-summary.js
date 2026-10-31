import path from "node:path";
import { promises as fsp } from "node:fs";

const recoverableTraversalCodes = new Set(["EACCES", "EPERM", "ENOENT", "ESTALE"]);

function isRecoverableTraversalError(error) {
  return recoverableTraversalCodes.has(String(error?.code || "").toUpperCase());
}

export async function summarizeDirectoryContents(rootPath, fsOps = fsp) {
  let size = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let skippedCount = 0;
  const pending = [rootPath];

  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = await fsOps.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (!isRecoverableTraversalError(error)) throw error;
      skippedCount += 1;
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        directoryCount += 1;
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = await fsOps.stat(entryPath);
        size += stat.size;
        fileCount += 1;
      } catch (error) {
        if (!isRecoverableTraversalError(error)) throw error;
        skippedCount += 1;
      }
    }
  }

  return { size, fileCount, directoryCount, skippedCount };
}