const API_KEY_STORAGE_KEY = "remote-ai-access-api-key";
const API_KEY_HEADER_STORAGE_KEY = "remote-ai-access-api-key-header";
const ADMIN_TOKEN_STORAGE_KEY = "remote-ai-access-admin-token";

function normalizeHeaderName(name) {
  const value = String(name || "").trim().toLowerCase();
  return value || "x-api-key";
}

function getApiKey() {
  return String(localStorage.getItem(API_KEY_STORAGE_KEY) || "").trim();
}

function setApiKey(value) {
  const next = String(value || "").trim();
  if (!next) {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    return;
  }
  localStorage.setItem(API_KEY_STORAGE_KEY, next);
}

function getApiKeyHeaderName() {
  return normalizeHeaderName(localStorage.getItem(API_KEY_HEADER_STORAGE_KEY));
}

function setApiKeyHeaderName(value) {
  localStorage.setItem(API_KEY_HEADER_STORAGE_KEY, normalizeHeaderName(value));
}

function getAdminToken() {
  return String(localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "").trim();
}

function setAdminToken(value) {
  const next = String(value || "").trim();
  if (!next) {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, next);
}

function patchFetchForApiKey() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init) {
    const nextInit = init ? { ...init } : {};
    let requestUrl = "";
    if (typeof input === "string") {
      requestUrl = input;
    } else if (input && typeof input.url === "string") {
      requestUrl = input.url;
    }

    let url;
    try {
      url = new URL(requestUrl || "/", window.location.origin);
    } catch {
      return originalFetch(input, nextInit);
    }

    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, nextInit);
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return originalFetch(input, nextInit);
    }

    const headerName = getApiKeyHeaderName();
    const headers = new Headers(nextInit.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has(headerName)) {
      headers.set(headerName, apiKey);
    }
    nextInit.headers = headers;

    return originalFetch(input, nextInit);
  };
}

patchFetchForApiKey();

window.RemoteAiAuth = {
  getApiKey,
  setApiKey,
  getApiKeyHeaderName,
  setApiKeyHeaderName,
  getAdminToken,
  setAdminToken,
  keys: {
    apiKey: API_KEY_STORAGE_KEY,
    apiKeyHeader: API_KEY_HEADER_STORAGE_KEY,
    adminToken: ADMIN_TOKEN_STORAGE_KEY
  }
};
