import test from "node:test";
import assert from "node:assert/strict";

import { buildAutomaticGitAddArgs, isManagedGitPath, isNothingToCommit, normalizeGitChangePaths, parseGitStatusPorcelain } from "../src/git-change-center.js";

test("parses branch, staged, unstaged, untracked, rename, and conflicts", () => {
  const output = "## feature...origin/feature [ahead 2, behind 1]\0M  staged.js\0 M local.js\0?? new file.txt\0R  renamed.js\0old.js\0UU conflict.txt\0";
  assert.deepEqual(parseGitStatusPorcelain(output), {
    branch: "feature",
    upstream: "origin/feature",
    ahead: 2,
    behind: 1,
    files: [
      { path: "staged.js", originalPath: "", code: "M ", staged: true, unstaged: false, untracked: false, conflict: false },
      { path: "local.js", originalPath: "", code: " M", staged: false, unstaged: true, untracked: false, conflict: false },
      { path: "new file.txt", originalPath: "", code: "??", staged: false, unstaged: true, untracked: true, conflict: false },
      { path: "renamed.js", originalPath: "old.js", code: "R ", staged: true, unstaged: false, untracked: false, conflict: false },
      { path: "conflict.txt", originalPath: "", code: "UU", staged: false, unstaged: false, untracked: false, conflict: true }
    ]
  });
});

test("normalizes bounded workspace-relative path selections", () => {
  assert.deepEqual(normalizeGitChangePaths(["src\\app.js", "../secret", "/README.md", "src/app.js"]), ["src/app.js", "README.md"]);
});

test("excludes server-managed paths from automatic staging", () => {
  assert.deepEqual(buildAutomaticGitAddArgs(), [
    "add", "-A", "--", ".", ":!.audit-log.jsonl", ":!.cache", ":!.upload-sessions", ":!**/__pycache__", ":!**/__pycache__/**"
  ]);
  assert.deepEqual(buildAutomaticGitAddArgs(["src/app.js", "src/app.js"]), ["add", "-A", "--", "src/app.js"]);
  assert.equal(isManagedGitPath(".cache/tmp.123/file"), true);
  assert.equal(isManagedGitPath("mib_tools/__pycache__/module.pyc"), true);
  assert.equal(isManagedGitPath("src/.cache/file"), false);
});

test("recognizes a no-op commit when Git warnings are written to stderr", () => {
  assert.equal(isNothingToCommit({ code: 1, stdout: "nothing to commit, working tree clean\n", stderr: "warning: permission denied\n" }), true);
  assert.equal(isNothingToCommit({ code: 1, stdout: "", stderr: "fatal: adding files failed\n" }), false);
});