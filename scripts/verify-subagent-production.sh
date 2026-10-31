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

prompt='Use spawn_subagent once with role research, idempotencyKey live-subagent-v1, allowedTools [list_tools], and task: list your available tools and summarize whether write_file or run_terminal is available. Then use wait_subagents for that child and report its conclusion.'
body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"read-only",messages:[{role:"user",content:process.env.PROMPT}]}))')
started=$(curl -fsS -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" -H "$header: $key" -H "content-type: application/json" --data "$body" http://127.0.0.1:8787/api/chat/jobs)
id=$(STARTED="$started" node -e 'process.stdout.write(JSON.parse(process.env.STARTED).job?.id || "")')
test -n "$id"

attempt=0
while test "$attempt" -lt 180; do
  result=$(curl -fsS -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" -H "$header: $key" "http://127.0.0.1:8787/api/chat/jobs/$id")
  status=$(RESULT="$result" node -e 'process.stdout.write(JSON.parse(process.env.RESULT).job?.status || "")')
  case "$status" in
    completed|failed|cancelled) break ;;
  esac
  attempt=$((attempt + 1))
  sleep 1
done

RESULT="$result" node -e 'const job=JSON.parse(process.env.RESULT).job || {}; const reply=job.result?.reply || ""; console.log(JSON.stringify({status:job.status,executedTools:job.result?.executedTools,replyHasReadOnlyConclusion:/write_file|run_terminal|read.only/i.test(reply),error:job.error}, null, 2))'