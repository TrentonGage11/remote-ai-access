#!/bin/sh
set -eu

cd /opt/remote-ai-access
set -a
. ./.env
set +a

settings_path=${ADMIN_SETTINGS_DB_PATH:-./sandbox/_admin/settings-db.json}
key=$(node -e 'const settings=require(process.argv[1]); if (!settings.apiKeys?.[0]) process.exit(1); process.stdout.write(settings.apiKeys[0])' "$settings_path")
header=$(node -e 'const settings=require(process.argv[1]); process.stdout.write(settings.apiKeyHeaderName || "x-api-key")' "$settings_path")

if test -n "${XAI_API_KEY:-}"; then
  provider=xai
  model=${XAI_MODEL:-grok-4.6}
elif test -n "${OPENAI_API_KEY:-}"; then
  provider=openai
  model=${OPENAI_MODEL:-gpt-4.1}
else
  provider=google
  model=${GOOGLE_MODEL:-gemini-3.7-flash}
fi

prompt='Call deploy_application exactly once with action preview and this manifest: application preview-media, hostname preview-foundation.tg11.org, runtime static, artifactPath images, healthPath /healthz, no environment names, persistentData false. Do not call any other tool. Report whether the result is dry-run only and whether activation is available.'
body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"deployment",messages:[{role:"user",content:process.env.PROMPT}]}))')
started=$(curl -fsS -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" -H "$header: $key" -H "x-workspace-code: debugging-media" -H "content-type: application/json" --data "$body" http://127.0.0.1:8787/api/chat/jobs)
id=$(STARTED="$started" node -e 'process.stdout.write(JSON.parse(process.env.STARTED).job?.id || "")')
test -n "$id"

attempt=0
while test "$attempt" -lt 180; do
  result=$(curl -fsS -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" -H "$header: $key" -H "x-workspace-code: debugging-media" "http://127.0.0.1:8787/api/chat/jobs/$id")
  status=$(RESULT="$result" node -e 'process.stdout.write(JSON.parse(process.env.RESULT).job?.status || "")')
  case "$status" in
    completed|failed|cancelled) break ;;
  esac
  attempt=$((attempt + 1))
  sleep 1
done

RESULT="$result" node - <<'NODE'
const job = JSON.parse(process.env.RESULT).job || {};
const executedTools = job.result?.executedTools || [];
const reply = job.result?.reply || "";
const output = {
  status: job.status,
  executedTools,
  onlyDeploymentTool: executedTools.length === 1 && executedTools[0] === "deploy_application",
  replyConfirmsDryRun: /dry.?run|preview only/i.test(reply),
  replyConfirmsNoActivation: /activation.*(?:not available|unavailable|requires.*approval)|approval.*required/i.test(reply),
  error: job.error || null
};
console.log(JSON.stringify(output, null, 2));
if (output.status !== "completed" || !output.onlyDeploymentTool || !output.replyConfirmsDryRun || !output.replyConfirmsNoActivation || output.error) {
  process.exit(1);
}
NODE