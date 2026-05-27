const adminTokenInputEl = document.getElementById("adminTokenInput");
const saveAdminTokenBtnEl = document.getElementById("saveAdminTokenBtn");
const loadSettingsBtnEl = document.getElementById("loadSettingsBtn");
const browserApiKeyInputEl = document.getElementById("browserApiKeyInput");
const saveBrowserKeyBtnEl = document.getElementById("saveBrowserKeyBtn");
const clearBrowserKeyBtnEl = document.getElementById("clearBrowserKeyBtn");
const apiKeyAuthEnabledInputEl = document.getElementById("apiKeyAuthEnabledInput");
const apiKeyRequireHeaderOnlyInputEl = document.getElementById("apiKeyRequireHeaderOnlyInput");
const apiKeyHeaderNameInputEl = document.getElementById("apiKeyHeaderNameInput");
const apiKeysInputEl = document.getElementById("apiKeysInput");
const protectedPrefixesInputEl = document.getElementById("protectedPrefixesInput");
const exemptPrefixesInputEl = document.getElementById("exemptPrefixesInput");
const agentOverrideCodeInputEl = document.getElementById("agentOverrideCodeInput");
const uploadBypassCodesInputEl = document.getElementById("uploadBypassCodesInput");
const saveSettingsBtnEl = document.getElementById("saveSettingsBtn");
const reloadSettingsBtnEl = document.getElementById("reloadSettingsBtn");
const statusEl = document.getElementById("status");
const settingsJsonEl = document.getElementById("settingsJson");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#bf2e2e" : "";
}

function toList(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseJsonResponse(response) {
  return response.text().then((text) => {
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  });
}

function getAdminToken() {
  return String(window.RemoteAiAuth?.getAdminToken?.() || "").trim();
}

function getAdminHeaders() {
  const token = getAdminToken();
  if (!token) {
    throw new Error("Admin token is required");
  }
  return {
    "Content-Type": "application/json",
    "x-admin-token": token
  };
}

function fillForm(settings = {}) {
  apiKeyAuthEnabledInputEl.checked = Boolean(settings.apiKeyAuthEnabled);
  apiKeyRequireHeaderOnlyInputEl.checked = settings.apiKeyRequireHeaderOnly !== false;
  apiKeyHeaderNameInputEl.value = String(settings.apiKeyHeaderName || "x-api-key");
  apiKeysInputEl.value = Array.isArray(settings.apiKeys) ? settings.apiKeys.join("\n") : "";
  protectedPrefixesInputEl.value = Array.isArray(settings.apiKeyProtectedPathPrefixes)
    ? settings.apiKeyProtectedPathPrefixes.join("\n")
    : "";
  exemptPrefixesInputEl.value = Array.isArray(settings.apiKeyExemptPathPrefixes)
    ? settings.apiKeyExemptPathPrefixes.join("\n")
    : "";
  agentOverrideCodeInputEl.value = String(settings.agentMaxStepsOverrideCode || "");
  uploadBypassCodesInputEl.value = String(settings.workspaceUploadBypassCodesRaw || "");

  if (window.RemoteAiAuth?.setApiKeyHeaderName) {
    window.RemoteAiAuth.setApiKeyHeaderName(apiKeyHeaderNameInputEl.value || "x-api-key");
  }
}

function collectPayload() {
  const headerName = String(apiKeyHeaderNameInputEl.value || "x-api-key").trim().toLowerCase() || "x-api-key";
  return {
    apiKeyAuthEnabled: Boolean(apiKeyAuthEnabledInputEl.checked),
    apiKeyRequireHeaderOnly: Boolean(apiKeyRequireHeaderOnlyInputEl.checked),
    apiKeyHeaderName: headerName,
    apiKeys: toList(apiKeysInputEl.value),
    apiKeyProtectedPathPrefixes: toList(protectedPrefixesInputEl.value),
    apiKeyExemptPathPrefixes: toList(exemptPrefixesInputEl.value),
    agentMaxStepsOverrideCode: String(agentOverrideCodeInputEl.value || "").trim(),
    workspaceUploadBypassCodesRaw: String(uploadBypassCodesInputEl.value || "").trim()
  };
}

async function loadSecuritySettings() {
  setStatus("Loading settings...");
  try {
    const response = await fetch("/api/admin/security", {
      method: "GET",
      headers: {
        "x-admin-token": getAdminToken()
      },
      cache: "no-store"
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Failed to load settings");
    }

    fillForm(data);
    settingsJsonEl.textContent = JSON.stringify(data, null, 2);
    setStatus("Settings loaded.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function saveSecuritySettings() {
  setStatus("Saving settings...");
  try {
    const payload = collectPayload();
    const response = await fetch("/api/admin/security", {
      method: "PUT",
      headers: getAdminHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Failed to save settings");
    }

    if (window.RemoteAiAuth?.setApiKeyHeaderName) {
      window.RemoteAiAuth.setApiKeyHeaderName(payload.apiKeyHeaderName);
    }

    fillForm(data.settings || {});
    settingsJsonEl.textContent = JSON.stringify(data.settings || data, null, 2);
    setStatus("Settings saved. Changes are live immediately.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

function initStoredValues() {
  adminTokenInputEl.value = getAdminToken();
  browserApiKeyInputEl.value = String(window.RemoteAiAuth?.getApiKey?.() || "");
}

saveAdminTokenBtnEl.addEventListener("click", () => {
  const token = String(adminTokenInputEl.value || "").trim();
  window.RemoteAiAuth?.setAdminToken?.(token);
  setStatus(token ? "Admin token saved locally." : "Admin token cleared.");
});

saveBrowserKeyBtnEl.addEventListener("click", () => {
  const key = String(browserApiKeyInputEl.value || "").trim();
  window.RemoteAiAuth?.setApiKey?.(key);
  setStatus(key ? "Browser API key saved locally." : "Browser API key cleared.");
});

clearBrowserKeyBtnEl.addEventListener("click", () => {
  browserApiKeyInputEl.value = "";
  window.RemoteAiAuth?.setApiKey?.("");
  setStatus("Browser API key cleared.");
});

loadSettingsBtnEl.addEventListener("click", () => {
  const token = String(adminTokenInputEl.value || "").trim();
  window.RemoteAiAuth?.setAdminToken?.(token);
  loadSecuritySettings();
});

saveSettingsBtnEl.addEventListener("click", () => {
  const token = String(adminTokenInputEl.value || "").trim();
  window.RemoteAiAuth?.setAdminToken?.(token);
  saveSecuritySettings();
});

reloadSettingsBtnEl.addEventListener("click", () => {
  loadSecuritySettings();
});

initStoredValues();
