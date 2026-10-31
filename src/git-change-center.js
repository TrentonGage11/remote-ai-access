const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const MANAGED_GIT_PATHS = [".audit-log.jsonl", ".cache", ".upload-sessions"];
const GENERATED_GIT_DIRECTORY_NAMES = new Set(["__pycache__"]);

export function isManagedGitPath(value) {
  const path = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  return MANAGED_GIT_PATHS.some((managedPath) => path === managedPath || path.startsWith(`${managedPath}/`))
    || path.split("/").some((part) => GENERATED_GIT_DIRECTORY_NAMES.has(part));
}

export function buildAutomaticGitAddArgs(paths = []) {
  const scopedPaths = [...new Set(paths.map((item) => String(item || "").trim()).filter(Boolean))];
  if (scopedPaths.length > 0) return ["add", "-A", "--", ...scopedPaths];
  return ["add", "-A", "--", ".", ...MANAGED_GIT_PATHS.map((managedPath) => `:!${managedPath}`), ":!**/__pycache__", ":!**/__pycache__/**"];
}

export function isNothingToCommit(result) {
  return /nothing to commit|no changes added/i.test(`${result?.stdout || ""}\n${result?.stderr || ""}`);
}

export function parseGitStatusPorcelain(output) {
  const records = String(output || "").split("\0");
  const result = { branch: "", upstream: "", ahead: 0, behind: 0, files: [] };
  let index = 0;
  if (records[0]?.startsWith("## ")) {
    const header = records[0].slice(3);
    const match = /^(.*?)(?:\.\.\.([^ \[]+))?(?: \[ahead (\d+)(?:, behind (\d+))?\]| \[behind (\d+)\])?$/.exec(header);
    result.branch = String(match?.[1] || header).replace(/^No commits yet on /, "");
    result.upstream = match?.[2] || "";
    result.ahead = Number(match?.[3] || 0);
    result.behind = Number(match?.[4] || match?.[5] || 0);
    index = 1;
  }

  while (index < records.length) {
    const record = records[index];
    index += 1;
    if (!record || record.length < 4) continue;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    let originalPath = "";
    if ((code[0] === "R" || code[0] === "C") && records[index]) {
      originalPath = records[index];
      index += 1;
    }
    const conflict = CONFLICT_CODES.has(code);
    result.files.push({
      path,
      originalPath,
      code,
      staged: !conflict && code[0] !== " " && code[0] !== "?",
      unstaged: !conflict && code[1] !== " ",
      untracked: code === "??",
      conflict
    });
  }
  return result;
}

export function normalizeGitChangePaths(paths, maxPaths = 100) {
  const values = Array.isArray(paths) ? paths : [paths];
  const normalized = [];
  for (const value of values) {
    const path = String(value || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
    if (!path || path.includes("\0") || path.split("/").includes("..")) continue;
    if (!normalized.includes(path)) normalized.push(path);
    if (normalized.length >= maxPaths) break;
  }
  return normalized;
}