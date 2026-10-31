const RESEARCH_TOOLS = Object.freeze([
  "list_tools",
  "list_apis",
  "tool_status",
  "list_context",
  "list_directory",
  "read_file",
  "search_web",
  "agent_reach_status",
  "search_internet",
  "search_images",
  "search_youtube",
  "get_youtube_transcript",
  "fetch_webpage",
  "preview_markdown",
  "search_workspace"
]);

const REVIEW_TOOLS = Object.freeze([...RESEARCH_TOOLS]);
const IMAGE_TOOLS = Object.freeze([
  "list_tools",
  "list_directory",
  "read_file",
  "search_images",
  "generate_image",
  "process_image"
]);
const CODING_TOOLS = Object.freeze([
  ...REVIEW_TOOLS,
  "format_code",
  "lint_code",
  "run_tests",
  "write_file"
]);

const ROLE_TOOLS = Object.freeze({
  research: RESEARCH_TOOLS,
  review: REVIEW_TOOLS,
  image: IMAGE_TOOLS,
  coding: CODING_TOOLS
});

const ROLE_DEFAULTS = Object.freeze({
  research: Object.freeze({ maxSteps: 64, timeoutMs: 15 * 60 * 1000 }),
  review: Object.freeze({ maxSteps: 96, timeoutMs: 20 * 60 * 1000 }),
  image: Object.freeze({ maxSteps: 64, timeoutMs: 15 * 60 * 1000 }),
  coding: Object.freeze({ maxSteps: 128, timeoutMs: 30 * 60 * 1000 })
});

export const SUBAGENT_LIMITS = Object.freeze({
  maxChildrenPerParent: 8,
  maxConcurrentPerParent: 4,
  maxSteps: 256,
  maxRuntimeMs: 60 * 60 * 1000,
  maxSummaryChars: 12_000,
  maxEvents: 4096
});

export function normalizeSubagentRole(value) {
  const role = String(value || "research").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROLE_TOOLS, role) ? role : null;
}

export function resolveSubagentAllowedTools({ role, requestedTools, parentTools } = {}) {
  const normalizedRole = normalizeSubagentRole(role);
  if (!normalizedRole) return [];
  const defaults = ROLE_TOOLS[normalizedRole];
  const roleTools = new Set(defaults);
  const parent = new Set(Array.isArray(parentTools) ? parentTools : []);
  const requested = Array.isArray(requestedTools) && requestedTools.length > 0
    ? requestedTools
    : defaults;
  return [...new Set(requested.map((item) => String(item || "").trim()))]
    .filter((name) => roleTools.has(name) && parent.has(name));
}

export function normalizeSubagentLimits(input = {}, roleValue = "research") {
  const role = normalizeSubagentRole(roleValue) || "research";
  const defaults = ROLE_DEFAULTS[role];
  return {
    maxSteps: Math.max(1, Math.min(SUBAGENT_LIMITS.maxSteps, Number(input.maxSteps || defaults.maxSteps))),
    timeoutMs: Math.max(5_000, Math.min(SUBAGENT_LIMITS.maxRuntimeMs, Number(input.timeoutMs || defaults.timeoutMs)))
  };
}

export function normalizeSubagentAllowedPaths(values, limit = 20) {
  const paths = [];
  for (const value of Array.isArray(values) ? values : []) {
    const candidate = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!candidate || candidate.startsWith("/") || candidate.includes("\0") || candidate.split("/").includes("..")) continue;
    if (!paths.includes(candidate)) paths.push(candidate.slice(0, 500));
    if (paths.length >= Math.max(1, Math.min(100, Number(limit || 20)))) break;
  }
  return paths;
}

export function isSubagentWritePathAllowed(pathValue, allowedPaths) {
  const [candidate] = normalizeSubagentAllowedPaths([pathValue], 1);
  return Boolean(candidate) && normalizeSubagentAllowedPaths(allowedPaths).some((scope) => (
    scope.endsWith("/") ? candidate.startsWith(scope) : candidate === scope
  ));
}