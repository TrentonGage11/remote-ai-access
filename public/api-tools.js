const tableBody = document.querySelector("#toolsTable tbody");
const agentToolsTableBody = document.querySelector("#agentToolsTable tbody");
const detailsJson = document.getElementById("detailsJson");
const runToolStatusBtnEl = document.getElementById("runToolStatusBtn");
const toolStatusNameInputEl = document.getElementById("toolStatusNameInput");
const toolStatusOutputEl = document.getElementById("toolStatusOutput");

const featureMap = [
  { key: "/api/files/write", name: "Edit File" },
  { key: "/api/files/upload", name: "Upload File" },
  { key: "/api/files/download", name: "Download File" },
  { key: "/api/files/list", name: "List Directory" },
  { key: "/api/files/format", name: "Format/Lint Code" },
  { key: "/api/files/move", name: "Move Path" },
  { key: "/api/files/rename", name: "Rename Path" },
  { key: "/api/files/delete", name: "Delete Path" },
  { key: "/api/files/lint", name: "Lint JS/TS" },
  { key: "/api/files/audit", name: "Audit Entries" },
  { key: "/api/files/git/log", name: "Git Snapshot Log" },
  { key: "/api/files/git/revert", name: "Revert Sandbox" },
  { key: "/api/files/snapshots", name: "Backup Snapshots" },
  { key: "/api/files/diff", name: "Diff Review" },
  { key: "/api/files/merge/from-snapshot", name: "Merge From Snapshot" },
  { key: "/api/files/search", name: "Workspace Search" },
  { key: "/api/tests/run", name: "Automated Test Runner" }
];

function renderTable(tools) {
  tableBody.innerHTML = "";
  for (const item of featureMap) {
    const match = tools.find((tool) => tool.path.startsWith(item.key));
    if (!match) {
      continue;
    }

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.name}</td>
      <td><code>${match.method} ${match.path}</code></td>
      <td>Call endpoint with JSON body/query as documented.</td>
    `;
    tableBody.appendChild(row);
  }
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

    renderTable(data.tools || []);
    renderAgentToolsTable(data.agentToolReference || []);
    detailsJson.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    detailsJson.textContent = `Error: ${error.message}`;
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
