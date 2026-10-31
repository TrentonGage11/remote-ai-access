import path from "node:path";

const ARTIFACT_TOOLS = new Set(["write_file", "generate_image", "process_image"]);

function normalizeArtifactPath(value) {
  const candidate = String(value || "").trim().replace(/\\/g, "/");
  if (!candidate || path.posix.isAbsolute(candidate) || candidate.split("/").includes("..")) return "";
  return candidate.slice(0, 500);
}

export function collectSubagentArtifacts(events, limit = 40) {
  const artifacts = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== "tool-end" || event?.payload?.ok === false) continue;
    const tool = String(event?.payload?.name || "");
    if (!ARTIFACT_TOOLS.has(tool)) continue;
    const output = event?.payload?.output;
    if (!output || typeof output !== "object") continue;
    for (const key of ["path", "outputPath", "archivePath"]) {
      const artifactPath = normalizeArtifactPath(output[key]);
      if (!artifactPath || artifacts.has(artifactPath)) continue;
      artifacts.set(artifactPath, {
        path: artifactPath,
        tool: tool.slice(0, 120)
      });
      if (artifacts.size >= Math.max(1, Math.min(100, Number(limit || 40)))) return [...artifacts.values()];
    }
  }
  return [...artifacts.values()];
}

function parseDirectiveBody(value) {
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const meta = {};
  let index = 0;
  while (index < lines.length) {
    const match = lines[index].match(/^([a-z][a-z0-9_-]*):\s*(.*)$/i);
    if (!match) break;
    meta[match[1].toLowerCase()] = match[2].trim();
    index += 1;
  }
  return { meta, content: lines.slice(index).join("\n").trim() };
}

export function extractSubagentContextProposals(summary, limit = 20) {
  const proposals = [];
  const pattern = /```raa-context[ \t]+(add|update|remove)[ \t]*\r?\n([\s\S]*?)```/gi;
  for (const match of String(summary || "").matchAll(pattern)) {
    const action = match[1].toLowerCase();
    const { meta, content } = parseDirectiveBody(match[2]);
    const proposal = {
      action,
      scope: String(meta.scope || "chat").toLowerCase() === "global" ? "global" : "chat",
      id: String(meta.id || "").slice(0, 120),
      label: String(meta.label || "").slice(0, 200),
      newLabel: String(meta["new-label"] || "").slice(0, 200),
      content: content.slice(0, 12000)
    };
    const hasTarget = proposal.id || proposal.label;
    if ((action === "add" && proposal.content) || (action !== "add" && hasTarget)) proposals.push(proposal);
    if (proposals.length >= Math.max(1, Math.min(60, Number(limit || 20)))) break;
  }
  return proposals;
}

export function mergeSubagentAcceptance(job, input = {}) {
  const artifacts = Array.isArray(job?.result?.artifacts) ? job.result.artifacts : [];
  const proposals = Array.isArray(job?.result?.proposedContextMutations) ? job.result.proposedContextMutations : [];
  const previous = job?.acceptance && typeof job.acceptance === "object" ? job.acceptance : {};
  const next = {
    artifacts: { ...(previous.artifacts || {}) },
    context: { ...(previous.context || {}) },
    updatedAt: new Date().toISOString()
  };
  const decisions = new Set(["accepted", "rejected"]);

  for (const [artifactPath, decision] of Object.entries(input?.artifacts || {})) {
    if (!artifacts.some((artifact) => artifact.path === artifactPath)) throw new Error("unknown subagent artifact");
    if (!decisions.has(decision)) throw new Error("artifact decision must be accepted or rejected");
    next.artifacts[artifactPath] = decision;
  }
  for (const [indexText, decision] of Object.entries(input?.context || {})) {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0 || index >= proposals.length) throw new Error("unknown subagent context proposal");
    if (!decisions.has(decision)) throw new Error("context decision must be accepted or rejected");
    next.context[String(index)] = decision;
  }
  return next;
}