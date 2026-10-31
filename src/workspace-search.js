import path from "node:path";
import { promises as fsp } from "node:fs";

const ignoredWorkspaceEntries = new Set([
  ".git",
  ".audit-log.jsonl",
  ".upload-sessions",
  ".home",
  ".cache",
  ".npm-global",
  ".python-packages"
]);

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((item) => item.length >= 2);
}

function locationFromOffset(text, offset) {
  const before = String(text || "").slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1) || "").length + 1 };
}

function snippetFromOffset(content, offset, matchLength) {
  const text = String(content || "");
  const start = Math.max(0, offset - 80);
  const end = Math.min(text.length, offset + Math.max(1, matchLength) + 140);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function escapedRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileQuery(query, regex, caseSensitive, global = true) {
  const flags = `${global ? "g" : ""}${caseSensitive ? "" : "i"}`;
  try {
    return new RegExp(regex ? query : escapedRegex(query), flags);
  } catch (error) {
    throw new Error(`invalid regular expression: ${error.message}`);
  }
}

async function collectFiles(root, limit) {
  const files = [];
  const stack = [root];
  while (stack.length > 0 && files.length < limit) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoredWorkspaceEntries.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.isFile()) files.push(target);
      if (files.length >= limit) break;
    }
  }
  return files;
}

async function searchTargets(basePath, maxFiles) {
  const stat = await fsp.stat(basePath);
  return stat.isDirectory() ? collectFiles(basePath, maxFiles) : [basePath];
}

export async function searchWorkspaceFiles(rootPath, basePath, args = {}) {
  const query = String(args.query || "").trim();
  if (!query) throw new Error("query is required");

  const requestedMode = String(args.mode || "hybrid").trim().toLowerCase();
  const mode = requestedMode === "full" ? "text" : requestedMode;
  if (!new Set(["filename", "text", "semantic", "hybrid", "regex"]).has(mode)) {
    throw new Error("mode must be filename, text, semantic, hybrid, or regex");
  }

  const limit = Math.max(1, Math.min(100, Number(args.limit || 20)));
  const maxFiles = Math.max(1, Math.min(800, Number(args.maxFiles || 300)));
  const maxFileBytes = Math.max(2048, Math.min(1024 * 1024, Number(args.maxFileBytes || 300000)));
  const targets = await searchTargets(basePath, maxFiles);
  const queryLower = query.toLowerCase();
  const caseSensitive = Boolean(args.caseSensitive);
  const queryTokens = new Set(tokenize(query));
  const regex = mode === "regex" ? compileQuery(query, true, caseSensitive, false) : null;
  const results = [];

  for (const filePath of targets) {
    const relativePath = path.relative(rootPath, filePath).replaceAll("\\", "/");
    const pathLower = relativePath.toLowerCase();
    const filenameMatch = caseSensitive ? relativePath.includes(query) : pathLower.includes(queryLower);
    if (mode === "filename") {
      if (filenameMatch) {
        results.push({ path: relativePath, score: 1, exactCount: 0, semanticScore: 0, filenameMatch: true, line: 1, column: 1, snippet: relativePath });
      }
      continue;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
      if (!stat.isFile() || stat.size > maxFileBytes) continue;
    } catch {
      continue;
    }

    let content;
    try {
      content = await fsp.readFile(filePath, "utf8");
      if (content.includes("\0")) continue;
    } catch {
      continue;
    }

    const lower = content.toLowerCase();
    const searchableContent = caseSensitive ? content : lower;
    const searchableQuery = caseSensitive ? query : queryLower;
    const firstMatch = mode === "regex" ? regex.exec(content) : null;
    regex && (regex.lastIndex = 0);
    const firstOffset = mode === "regex" ? firstMatch?.index ?? -1 : searchableContent.indexOf(searchableQuery);
    const exactCount = mode === "regex"
      ? (content.match(compileQuery(query, true, caseSensitive)) || []).length
      : searchableContent.split(searchableQuery).length - 1;
    const fileTokens = new Set(tokenize(content.slice(0, 12000)));
    let overlap = 0;
    for (const token of queryTokens) if (fileTokens.has(token)) overlap += 1;
    const semanticScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;

    let score = exactCount;
    if (mode === "semantic") score = semanticScore;
    if (mode === "hybrid") score = exactCount * 1.25 + semanticScore + (filenameMatch ? 1.5 : 0);
    if (score <= 0) continue;

    const offset = firstOffset >= 0 ? firstOffset : 0;
    const location = locationFromOffset(content, offset);
    results.push({
      path: relativePath,
      score: Number(score.toFixed(4)),
      exactCount,
      semanticScore: Number(semanticScore.toFixed(4)),
      filenameMatch,
      ...location,
      snippet: snippetFromOffset(content, offset, firstMatch?.[0]?.length || query.length),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString()
    });
  }

  results.sort((left, right) => right.score - left.score || right.exactCount - left.exactCount || left.path.localeCompare(right.path));
  return { filesScanned: targets.length, resultCount: results.length, results: results.slice(0, limit) };
}

export async function previewWorkspaceReplacements(rootPath, basePath, args = {}) {
  const query = String(args.query || "");
  if (!query) throw new Error("query is required");
  const replacement = String(args.replacement || "");
  const maxFiles = Math.max(1, Math.min(800, Number(args.maxFiles || 300)));
  const matcher = compileQuery(query, Boolean(args.regex), Boolean(args.caseSensitive));
  const targets = await searchTargets(basePath, maxFiles);
  const files = [];

  for (const filePath of targets) {
    let original;
    try {
      original = await fsp.readFile(filePath, "utf8");
      if (original.includes("\0")) continue;
    } catch {
      continue;
    }
    matcher.lastIndex = 0;
    const matches = [...original.matchAll(matcher)];
    matcher.lastIndex = 0;
    if (matches.length === 0) continue;
    const updated = original.replace(matcher, replacement);
    const first = matches[0];
    files.push({
      path: path.relative(rootPath, filePath).replaceAll("\\", "/"),
      replacementCount: matches.length,
      ...locationFromOffset(original, first.index || 0),
      before: snippetFromOffset(original, first.index || 0, first[0].length),
      after: snippetFromOffset(updated, first.index || 0, replacement.length)
    });
  }
  return { filesScanned: targets.length, filesMatched: files.length, replacementCount: files.reduce((sum, file) => sum + file.replacementCount, 0), files };
}

export async function applyWorkspaceReplacements(rootPath, basePath, acceptedPaths, args = {}) {
  const accepted = new Set((Array.isArray(acceptedPaths) ? acceptedPaths : []).map((item) => String(item || "").replaceAll("\\", "/")));
  if (accepted.size === 0) throw new Error("accept at least one file");
  const preview = await previewWorkspaceReplacements(rootPath, basePath, args);
  const changedFiles = [];
  let replacementCount = 0;
  const matcher = compileQuery(String(args.query || ""), Boolean(args.regex), Boolean(args.caseSensitive));
  for (const file of preview.files) {
    if (!accepted.has(file.path)) continue;
    const absolute = path.resolve(rootPath, file.path);
    if (absolute !== rootPath && !absolute.startsWith(`${rootPath}${path.sep}`)) throw new Error("path escapes workspace");
    const original = await fsp.readFile(absolute, "utf8");
    matcher.lastIndex = 0;
    await fsp.writeFile(absolute, original.replace(matcher, String(args.replacement || "")), "utf8");
    changedFiles.push(file.path);
    replacementCount += file.replacementCount;
  }
  return { filesChanged: changedFiles.length, replacementCount, changedFiles };
}