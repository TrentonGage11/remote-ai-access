const agentToolsTableBody = document.querySelector("#agentToolsTable tbody");
const detailsJson = document.getElementById("detailsJson");
const runToolStatusBtnEl = document.getElementById("runToolStatusBtn");
const toolStatusNameInputEl = document.getElementById("toolStatusNameInput");
const toolStatusOutputEl = document.getElementById("toolStatusOutput");
const endpointGroupsEl = document.getElementById("endpointGroups");
const overviewMetaEl = document.getElementById("overviewMeta");
const endpointFilterInputEl = document.getElementById("endpointFilterInput");
const clearEndpointFilterBtnEl = document.getElementById("clearEndpointFilterBtn");

let latestToolsData = null;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function groupForPath(path) {
  if (!path.startsWith("/api/")) {
    return "Other";
  }
  const segment = String(path.split("/")[2] || "other").toLowerCase();
  const labelMap = {
    files: "Files",
    tests: "Tests",
    tools: "Metadata",
    config: "Metadata",
    chat: "Chat",
    session: "Session",
    notifications: "Notifications"
  };
  return labelMap[segment] || "Other";
}

function endpointSearchText(endpoint) {
  return [endpoint.method, endpoint.path, endpoint.purpose, JSON.stringify(endpoint.body || {})]
    .map((item) => String(item || "").toLowerCase())
    .join(" ");
}

function buildCurlSnippet(endpoint) {
  const method = String(endpoint.method || "GET").toUpperCase();
  const base = `curl -sS -X ${method} https://ai.tg11.org${endpoint.path}`;
  if (endpoint.body && method !== "GET") {
    return `${base} \\\n+  -H \"Content-Type: application/json\" \\\n+  -d '${JSON.stringify(endpoint.body)}'`;
  }
  return base;
}

function renderOverview(data) {
  if (!overviewMetaEl) {
    return;
  }
  const endpointCount = Array.isArray(data?.tools) ? data.tools.length : 0;
  const agentToolCount = Array.isArray(data?.agentToolReference) ? data.agentToolReference.length : 0;
  const workspaceCode = data?.workspaceCode || "unknown";
  const runtime = data?.terminal?.runtime || "unknown";
  overviewMetaEl.innerHTML = `
    <span class="meta-chip"><strong>Workspace:</strong> ${escapeHtml(workspaceCode)}</span>
    <span class="meta-chip"><strong>Endpoints:</strong> ${endpointCount}</span>
    <span class="meta-chip"><strong>Agent Tools:</strong> ${agentToolCount}</span>
    <span class="meta-chip"><strong>Terminal Runtime:</strong> ${escapeHtml(runtime)}</span>
  `;
}

function renderEndpoints(data, filterText = "") {
  if (!endpointGroupsEl) {
    return;
  }
  const tools = Array.isArray(data?.tools) ? data.tools : [];
  const normalizedFilter = String(filterText || "").trim().toLowerCase();
  const visibleTools = normalizedFilter
    ? tools.filter((endpoint) => endpointSearchText(endpoint).includes(normalizedFilter))
    : tools;

  if (visibleTools.length === 0) {
    endpointGroupsEl.innerHTML = "<p class=\"muted-inline\">No endpoints matched your filter.</p>";
    return;
  }

  const groups = new Map();
  for (const endpoint of visibleTools) {
    const group = groupForPath(String(endpoint.path || ""));
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push(endpoint);
  }

  const groupOrder = ["Chat", "Session", "Files", "Tests", "Notifications", "Metadata", "Other"];
  const ordered = [...groups.entries()].sort((a, b) => {
    const ai = groupOrder.indexOf(a[0]);
    const bi = groupOrder.indexOf(b[0]);
    if (ai !== bi) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    return a[0].localeCompare(b[0]);
  });

  endpointGroupsEl.innerHTML = ordered
    .map(([groupName, endpoints]) => {
      const cards = endpoints
        .sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")))
        .map((endpoint, index) => {
          const method = String(endpoint.method || "GET").toUpperCase();
          const path = String(endpoint.path || "");
          const purpose = String(endpoint.purpose || "No purpose description provided.");
          const body = endpoint.body ? JSON.stringify(endpoint.body, null, 2) : "";
          const curl = buildCurlSnippet(endpoint);
          const copyId = `${groupName}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "-");

          return `
            <article class="endpoint-card">
              <header class="endpoint-head">
                <span class="method-badge method-${method.toLowerCase()}">${method}</span>
                <code class="endpoint-path">${escapeHtml(path)}</code>
              </header>
              <p class="endpoint-purpose">${escapeHtml(purpose)}</p>
              ${body ? `
                <details class="endpoint-details">
                  <summary>Example request body</summary>
                  <pre class="doc-json">${escapeHtml(body)}</pre>
                </details>
              ` : ""}
              <details class="endpoint-details">
                <summary>Example curl</summary>
                <pre id="curl-${copyId}" class="doc-json">${escapeHtml(curl)}</pre>
                <button class="btn btn-soft copy-curl-btn" type="button" data-copy-target="curl-${copyId}">Copy curl</button>
              </details>
            </article>
          `;
        })
        .join("\n");

      return `
        <section class="endpoint-group">
          <h3>${escapeHtml(groupName)} <span class="tab-meta">(${endpoints.length})</span></h3>
          <div class="endpoint-grid">${cards}</div>
        </section>
      `;
    })
    .join("\n");
}

function renderAgentToolsTable(rows) {
  if (!agentToolsTableBody) {
    return;
  }
  agentToolsTableBody.innerHTML = "";
  for (const rowData of rows || []) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${rowData.toolName || ""}</code></td>
      <td>${rowData.description || ""}</td>
      <td>${rowData.whyUseful || ""}</td>
    `;
    agentToolsTableBody.appendChild(row);
  }
}

async function init() {
  try {
    const response = await fetch("/api/tools");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load API tools");
    }

    latestToolsData = data;
    renderOverview(data);
    renderEndpoints(data);
    renderAgentToolsTable(data.agentToolReference || []);
    detailsJson.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    detailsJson.textContent = `Error: ${error.message}`;
    if (endpointGroupsEl) {
      endpointGroupsEl.innerHTML = `<p class=\"muted-inline\">Error: ${escapeHtml(error.message)}</p>`;
    }
  }
}

async function runToolStatus() {
  toolStatusOutputEl.textContent = "Running...";
  try {
    const configResponse = await fetch("/api/config");
    const config = await configResponse.json();
    const model = config?.defaultModel || "gpt-4.1";
    const toolName = String(toolStatusNameInputEl.value || "").trim();
    const prompt = toolName
      ? `Call tool_status with name=${toolName} and limit=10. Return concise JSON only.`
      : "Call tool_status with limit=10. Return concise JSON only.";

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        model,
        agentMode: true,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    toolStatusOutputEl.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    toolStatusOutputEl.textContent = `Error: ${error.message}`;
  }
}

init();

if (runToolStatusBtnEl) {
  runToolStatusBtnEl.addEventListener("click", runToolStatus);
}

if (endpointFilterInputEl) {
  endpointFilterInputEl.addEventListener("input", () => {
    if (!latestToolsData) {
      return;
    }
    renderEndpoints(latestToolsData, endpointFilterInputEl.value);
  });
}

if (clearEndpointFilterBtnEl) {
  clearEndpointFilterBtnEl.addEventListener("click", () => {
    if (!endpointFilterInputEl) {
      return;
    }
    endpointFilterInputEl.value = "";
    if (latestToolsData) {
      renderEndpoints(latestToolsData, "");
    }
  });
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const copyBtn = target.closest(".copy-curl-btn");
  if (!copyBtn) {
    return;
  }
  const preId = copyBtn.getAttribute("data-copy-target");
  const pre = preId ? document.getElementById(preId) : null;
  if (!pre) {
    return;
  }

  try {
    await navigator.clipboard.writeText(pre.textContent || "");
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy curl";
    }, 1200);
  } catch {
    copyBtn.textContent = "Copy failed";
    setTimeout(() => {
      copyBtn.textContent = "Copy curl";
    }, 1200);
  }
});
