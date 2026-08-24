const THEME_STORAGE_KEY = "remote-ai-access-theme";
const NOTIFICATION_RULES_KEY = "remote-ai-access-notification-rules-v1";

const themeToggleEl = document.getElementById("themeToggle");
const rulesStatusEl = document.getElementById("rulesStatus");
const ruleFormEl = document.getElementById("ruleForm");
const rulesListEl = document.getElementById("rulesList");
const clearRulesBtnEl = document.getElementById("clearRulesBtn");

const ruleNameEl = document.getElementById("ruleName");
const ruleEnabledEl = document.getElementById("ruleEnabled");
const ruleMessageIncludesEl = document.getElementById("ruleMessageIncludes");
const ruleCooldownMsEl = document.getElementById("ruleCooldownMs");

const sevInfoEl = document.getElementById("sevInfo");
const sevSuccessEl = document.getElementById("sevSuccess");
const sevWarningEl = document.getElementById("sevWarning");
const sevErrorEl = document.getElementById("sevError");

const actToastEl = document.getElementById("actToast");
const actDesktopEl = document.getElementById("actDesktop");
const actSoundEl = document.getElementById("actSound");
const actTitleFlashEl = document.getElementById("actTitleFlash");
const actWebhookEl = document.getElementById("actWebhook");
const ruleWebhookUrlEl = document.getElementById("ruleWebhookUrl");

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggleEl.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}

function initTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    applyTheme(storedTheme);
    return;
  }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeRule(input) {
  const createdAt = typeof input?.createdAt === "string" ? input.createdAt : new Date().toISOString();
  const name = String(input?.name || "").trim().slice(0, 80);
  const messageIncludes = String(input?.messageIncludes || "").trim().slice(0, 120);
  const webhookUrl = String(input?.webhookUrl || "").trim().slice(0, 400);
  const cooldownMsRaw = Number(input?.cooldownMs);
  const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(0, Math.min(600000, cooldownMsRaw)) : 5000;

  return {
    id: String(input?.id || uid()),
    name: name || "Unnamed rule",
    enabled: input?.enabled !== false,
    messageIncludes,
    cooldownMs,
    severities: {
      info: input?.severities?.info !== false,
      success: input?.severities?.success !== false,
      warning: input?.severities?.warning !== false,
      error: input?.severities?.error !== false
    },
    actions: {
      toast: input?.actions?.toast !== false,
      desktop: input?.actions?.desktop !== false,
      sound: Boolean(input?.actions?.sound),
      titleFlash: Boolean(input?.actions?.titleFlash),
      webhook: Boolean(input?.actions?.webhook)
    },
    webhookUrl: isHttpUrl(webhookUrl) ? webhookUrl : "",
    createdAt,
    updatedAt: new Date().toISOString()
  };
}

function loadRules() {
  try {
    const raw = localStorage.getItem(NOTIFICATION_RULES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((rule) => sanitizeRule(rule));
  } catch {
    return [];
  }
}

function saveRules(rules) {
  const clean = Array.isArray(rules) ? rules.map((rule) => sanitizeRule(rule)) : [];
  localStorage.setItem(NOTIFICATION_RULES_KEY, JSON.stringify(clean));
}

function toRuleSummary(rule) {
  const sev = Object.entries(rule.severities)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .join(", ") || "none";

  const actions = Object.entries(rule.actions)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([name]) => name)
    .join(", ") || "none";

  return `Severities: ${sev} | Actions: ${actions} | Cooldown: ${rule.cooldownMs}ms${rule.messageIncludes ? ` | Match: \"${rule.messageIncludes}\"` : ""}${rule.actions.webhook && rule.webhookUrl ? ` | Webhook: ${rule.webhookUrl}` : ""}`;
}

function renderRules() {
  const rules = loadRules();
  rulesListEl.innerHTML = "";

  if (rules.length === 0) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.textContent = "No rules yet.";
    rulesListEl.appendChild(li);
    return;
  }

  for (const rule of rules) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.style.cursor = "default";

    const title = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `${rule.enabled ? "[ON]" : "[OFF]"} ${String(rule.name || "")}`;
    title.appendChild(name);

    const meta = document.createElement("div");
    meta.style.marginTop = "4px";
    meta.textContent = toRuleSummary(rule);

    const actionsRow = document.createElement("div");
    actionsRow.className = "top-actions";
    actionsRow.style.marginTop = "8px";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "btn btn-soft";
    toggleBtn.type = "button";
    toggleBtn.textContent = rule.enabled ? "Disable" : "Enable";
    toggleBtn.addEventListener("click", () => {
      const next = loadRules().map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
      saveRules(next);
      renderRules();
      rulesStatusEl.textContent = "Rule updated.";
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-soft danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      const next = loadRules().filter((item) => item.id !== rule.id);
      saveRules(next);
      renderRules();
      rulesStatusEl.textContent = "Rule deleted.";
    });

    actionsRow.appendChild(toggleBtn);
    actionsRow.appendChild(deleteBtn);

    li.appendChild(title);
    li.appendChild(meta);
    li.appendChild(actionsRow);
    rulesListEl.appendChild(li);
  }
}

function buildRuleFromForm() {
  const webhookChecked = actWebhookEl.checked;
  const webhookUrl = String(ruleWebhookUrlEl.value || "").trim();

  if (webhookChecked && !isHttpUrl(webhookUrl)) {
    throw new Error("Webhook is enabled but URL is not valid.");
  }

  const severities = {
    info: sevInfoEl.checked,
    success: sevSuccessEl.checked,
    warning: sevWarningEl.checked,
    error: sevErrorEl.checked
  };

  if (!Object.values(severities).some(Boolean)) {
    throw new Error("Select at least one severity.");
  }

  const actions = {
    toast: actToastEl.checked,
    desktop: actDesktopEl.checked,
    sound: actSoundEl.checked,
    titleFlash: actTitleFlashEl.checked,
    webhook: webhookChecked
  };

  if (!Object.values(actions).some(Boolean)) {
    throw new Error("Select at least one action.");
  }

  return sanitizeRule({
    id: uid(),
    name: ruleNameEl.value,
    enabled: ruleEnabledEl.checked,
    messageIncludes: ruleMessageIncludesEl.value,
    cooldownMs: Number(ruleCooldownMsEl.value || 5000),
    severities,
    actions,
    webhookUrl
  });
}

themeToggleEl.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_STORAGE_KEY, next);
  applyTheme(next);
});

ruleFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const rule = buildRuleFromForm();
    const next = [rule, ...loadRules()].slice(0, 200);
    saveRules(next);
    renderRules();
    ruleNameEl.value = "";
    ruleMessageIncludesEl.value = "";
    ruleWebhookUrlEl.value = "";
    rulesStatusEl.textContent = "Rule saved.";
  } catch (error) {
    rulesStatusEl.textContent = `Error: ${error.message}`;
  }
});

clearRulesBtnEl.addEventListener("click", () => {
  const ok = window.confirm("Delete all notification rules?");
  if (!ok) {
    return;
  }
  saveRules([]);
  renderRules();
  rulesStatusEl.textContent = "All rules deleted.";
});

initTheme();
renderRules();
