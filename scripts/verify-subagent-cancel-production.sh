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

key="operations-ui-cancel-$(date +%s)"
prompt="Use spawn_subagent exactly once with role research, idempotencyKey $key, allowedTools [search_web,fetch_webpage], maxSteps 20, timeoutMs 600000, and task: research ten independent sources about Node.js Unix socket security and compare each source in detail. Do not wait for the child. Return immediately after spawning it."
body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"read-only",messages:[{role:"user",content:process.env.PROMPT}]}))')
curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$body" "$base/api/chat" >/dev/null

attempt=0
child_id=
while test "$attempt" -lt 30; do
  all=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents")
  child_id=$(ALL="$all" KEY="$key" node -e 'const job=JSON.parse(process.env.ALL).jobs.find(function(item){return item.task?.includes("ten independent sources")&&["queued","running"].includes(item.status)});process.stdout.write(job?.id||"")')
  test -z "$child_id" || break
  attempt=$((attempt + 1))
  sleep 1
done
test -n "$child_id"

cancelled=$(curl -fsS -X DELETE -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents/$child_id")
CANCELLED="$cancelled" CHILD_ID="$child_id" node - <<'NODE'
const value = JSON.parse(process.env.CANCELLED);
const job = value.job || {};
const output = {
  correctChild: job.id === process.env.CHILD_ID,
  cancelled: job.status === "cancelled",
  terminalTimestamp: Boolean(job.completedAt),
  cancelEvent: job.events?.some((event) => event.type === "cancelled"),
  reasonVisible: /operations UI/i.test(job.error?.message || "")
};
console.log(JSON.stringify(output, null, 2));
if (!Object.values(output).every(Boolean)) process.exit(1);
NODE