#!/bin/sh
set -eu

cd /opt/remote-ai-access

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
workspace=debugging-media
base=http://127.0.0.1:8787
xai_key=$(read_service_env XAI_API_KEY 2>/dev/null || true)
openai_key=$(read_service_env OPENAI_API_KEY 2>/dev/null || true)
if test -n "$xai_key"; then provider=xai; model=$(read_service_env XAI_MODEL 2>/dev/null || printf '%s' grok-4.6)
elif test -n "$openai_key"; then provider=openai; model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' gpt-4.1)
else provider=google; model=$(read_service_env GOOGLE_MODEL 2>/dev/null || printf '%s' gemini-3.7-flash)
fi

prompt='Use spawn_subagent once with role research, idempotencyKey operations-ui-live-v1, allowedTools [list_tools], and task: inspect your available tools and state whether write_file is available. Then wait for that child and report its result.'
body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"read-only",messages:[{role:"user",content:process.env.PROMPT}]}))')
started=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$body" "$base/api/chat/jobs")
parent_id=$(STARTED="$started" node -e 'process.stdout.write(JSON.parse(process.env.STARTED).job?.id||"")')
test -n "$parent_id"

attempt=0
while test "$attempt" -lt 180; do
  parent=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/jobs/$parent_id")
  status=$(PARENT="$parent" node -e 'process.stdout.write(JSON.parse(process.env.PARENT).job?.status||"")')
  case "$status" in completed|failed|cancelled) break ;; esac
  attempt=$((attempt + 1))
  sleep 1
done

all=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents")
filtered=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?parentId=$parent_id&status=completed")
invalid_status=$(curl -sS -o /dev/null -w '%{http_code}' -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?status=invalid")

PARENT_ID="$parent_id" ALL="$all" FILTERED="$filtered" INVALID_STATUS="$invalid_status" node - <<'NODE'
const all = JSON.parse(process.env.ALL);
const filtered = JSON.parse(process.env.FILTERED);
const child = filtered.jobs?.[0];
const output = {
  workspaceSummary: Number.isInteger(all.summary?.total),
  parentFilter: filtered.jobs?.length === 1 && child?.parentId === process.env.PARENT_ID,
  completedFilter: child?.status === "completed",
  taskVisible: /available tools/i.test(child?.task || ""),
  permissionsVisible: Array.isArray(child?.allowedTools) && child.allowedTools.includes("list_tools"),
  eventsVisible: Array.isArray(child?.events) && child.events.length > 0,
  resultVisible: /write_file|available tools/i.test(child?.result?.summary || ""),
  invalidFilterRejected: process.env.INVALID_STATUS === "400"
};
console.log(JSON.stringify(output, null, 2));
if (!Object.values(output).every(Boolean)) process.exit(1);
NODE