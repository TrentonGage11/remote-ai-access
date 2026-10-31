const READ_ONLY_TOOLS = new Set([
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
  "search_workspace",
  "spawn_subagent",
  "get_subagent",
  "wait_subagents",
  "cancel_subagent"
]);

const STANDARD_BLOCKED_TOOLS = new Set([
  "delete_file",
  "rename_file",
  "run_terminal",
  "run_build",
  "git_ops",
  "export_import_workspace",
  "call_api",
  "manage_permissions",
  "manage_snapshots",
  "diff_merge",
  "schedule_task"
]);

const DEPLOYMENT_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  "deploy_application"
]);

export function normalizeAgentToolProfile(value) {
  const profile = String(value || "").trim().toLowerCase();
  return ["read-only", "standard", "full", "deployment"].includes(profile) ? profile : "full";
}

export function isAgentToolAllowed(toolName, profileValue) {
  const name = String(toolName || "").trim();
  const profile = normalizeAgentToolProfile(profileValue);
  if (!name) {
    return false;
  }
  if (name === "deploy_application") {
    return profile === "deployment";
  }
  if (profile === "deployment") {
    return DEPLOYMENT_TOOLS.has(name);
  }
  if (profile === "read-only") {
    return READ_ONLY_TOOLS.has(name);
  }
  if (profile === "standard") {
    return !STANDARD_BLOCKED_TOOLS.has(name);
  }
  return true;
}

export function filterAgentToolDefinitions(definitions, profileValue) {
  return (Array.isArray(definitions) ? definitions : [])
    .filter((definition) => isAgentToolAllowed(definition?.function?.name, profileValue));
}

export function agentToolPolicySummary(definitions) {
  const source = Array.isArray(definitions) ? definitions : [];
  return ["read-only", "standard", "full", "deployment"].map((profile) => ({
    profile,
    tools: filterAgentToolDefinitions(source, profile).map((definition) => definition.function.name)
  }));
}
