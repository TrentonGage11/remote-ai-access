export const MANAGED_TOOL_CONTAINER_LABEL = "org.remote-ai-access.tool=true";
export const MANAGED_TOOL_CONTAINER_CONFIRMATION = "REMOVE_MANAGED_TOOL_CONTAINERS";

export function parseManagedToolContainers(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((item) => ({
      id: String(item.ID || "").trim(),
      name: String(item.Names || "").trim(),
      image: String(item.Image || "").trim(),
      status: String(item.Status || "").trim(),
      state: String(item.State || "").trim(),
      size: String(item.Size || "").trim()
    }))
    .filter((item) => /^[a-f0-9]{12,64}$/i.test(item.id) && item.name.startsWith("raa-tool-"));
}

export function managedToolContainerIds(containers) {
  return [...new Set((Array.isArray(containers) ? containers : []).map((item) => String(item?.id || "").trim()))]
    .filter((id) => /^[a-f0-9]{12,64}$/i.test(id));
}