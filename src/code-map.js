import path from "node:path";
import { promises as fsp } from "node:fs";

const DEFAULT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", ".venv", "__pycache__", "dist", "build", "coverage"]);
const MAX_FILE_BYTES = 512 * 1024;

function normalizeLimit(value, fallback = 2000) {
  return Math.max(1, Math.min(10_000, Number(value || fallback)));
}

function relativeFile(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function addSymbol(symbols, kind, name, line, exported = false) {
  const clean = String(name || "").trim();
  if (!clean) return;
  symbols.push({ kind, name: clean.slice(0, 200), line, exported: Boolean(exported) });
}

function parseSource(source, extension) {
  const symbols = [];
  const imports = [];
  const lines = String(source || "").split(/\r?\n/);
  const addMatches = (regex, kind, exported = false) => {
    lines.forEach((line, index) => {
      let match;
      while ((match = regex.exec(line))) addSymbol(symbols, kind, match[1], index + 1, exported || /^\s*export\b/.test(line));
      regex.lastIndex = 0;
    });
  };

  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(extension)) {
    addMatches(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, "function");
    addMatches(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g, "class");
    addMatches(/\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, "function");
    lines.forEach((line, index) => {
      const match = line.match(/\bimport\s+(?:.+?\s+from\s+)?["']([^"']+)["']/) || line.match(/\brequire\(\s*["']([^"']+)["']\s*\)/);
      if (match) imports.push({ source: match[1].slice(0, 300), line: index + 1 });
    });
  } else if (extension === ".py") {
    addMatches(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, "function");
    addMatches(/^\s*class\s+([A-Za-z_]\w*)/gm, "class");
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:from\s+([^\s]+)\s+import|import\s+([^\s#]+))/);
      if (match) imports.push({ source: match[1] || match[2], line: index + 1 });
    });
  } else if ([".go", ".rs", ".java", ".rb", ".php"].includes(extension)) {
    addMatches(/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g, "function");
    addMatches(/\b(?:class|struct|trait|interface|module)\s+([A-Za-z_]\w*)/g, "class");
    lines.forEach((line, index) => {
      const match = line.match(/^\s*(?:use|import|require|include)\s*[\("']?([^\)"';\s]+)/);
      if (match) imports.push({ source: match[1], line: index + 1 });
    });
  }
  return { symbols: symbols.slice(0, 500), imports: imports.slice(0, 500) };
}

async function collectFiles(root, fsOps, extensions, files = [], current = root) {
  const entries = await fsOps.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) {
      await collectFiles(root, fsOps, extensions, files, path.join(current, entry.name));
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(current, entry.name));
    }
    if (files.length >= 10_000) break;
  }
  return files;
}

export async function buildCodeMap(rootPath, options = {}, fsOps = fsp) {
  const root = path.resolve(rootPath);
  const extensions = options.extensions instanceof Set ? options.extensions : DEFAULT_EXTENSIONS;
  const maxFiles = normalizeLimit(options.maxFiles, 10_000);
  const files = (await collectFiles(root, fsOps, extensions)).slice(0, maxFiles);
  const entries = [];
  let skipped = 0;
  for (const file of files) {
    try {
      const stat = await fsOps.stat(file);
      if (stat.size > MAX_FILE_BYTES) { skipped += 1; continue; }
      const source = await fsOps.readFile(file, "utf8");
      const parsed = parseSource(source, path.extname(file).toLowerCase());
      entries.push({ path: relativeFile(root, file), bytes: stat.size, mtimeMs: stat.mtimeMs, ...parsed });
    } catch (error) {
      if (["EACCES", "ENOENT", "EPERM"].includes(error?.code)) { skipped += 1; continue; }
      throw error;
    }
  }
  return { version: 1, generatedAt: new Date().toISOString(), root: root, files: entries, fileCount: entries.length, skippedCount: skipped };
}

export function codeMapSummary(map) {
  const files = Array.isArray(map?.files) ? map.files : [];
  return {
    version: map?.version || 1,
    generatedAt: map?.generatedAt || null,
    fileCount: files.length,
    symbolCount: files.reduce((total, item) => total + (item.symbols?.length || 0), 0),
    importCount: files.reduce((total, item) => total + (item.imports?.length || 0), 0),
    skippedCount: Number(map?.skippedCount || 0)
  };
}

export const CODE_MAP_DEFAULT_EXTENSIONS = DEFAULT_EXTENSIONS;
