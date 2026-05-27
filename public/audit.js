const refreshAuditBtnEl = document.getElementById("refreshAuditBtn");
const loadAuditBtnEl = document.getElementById("loadAuditBtn");
const limitInputEl = document.getElementById("limitInput");
const auditJsonEl = document.getElementById("auditJson");

async function loadAudit() {
  const limit = Math.max(1, Math.min(1000, Number(limitInputEl.value || 200)));
  try {
    const response = await fetch(`/api/files/audit?limit=${limit}`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load audit log");
    }
    auditJsonEl.textContent = JSON.stringify(data.entries || [], null, 2);
  } catch (error) {
    auditJsonEl.textContent = `Error: ${error.message}`;
  }
}

refreshAuditBtnEl.addEventListener("click", loadAudit);
loadAuditBtnEl.addEventListener("click", loadAudit);

loadAudit();
