#!/bin/sh
set -eu

cd /opt/remote-ai-access

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find((value)=>value.startsWith(prefix));if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
base=http://127.0.0.1:8787
workspace=debugging-media

if read_service_env XAI_API_KEY >/dev/null 2>&1; then
  provider=xai
  model=$(read_service_env XAI_MODEL 2>/dev/null || printf '%s' grok-4.6)
elif read_service_env OPENAI_API_KEY >/dev/null 2>&1; then
  provider=openai
  model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' gpt-4.1)
else
  provider=google
  model=$(read_service_env GOOGLE_MODEL 2>/dev/null || printf '%s' gemini-3.7-flash)
fi

prompt='Use search_images once for query "green aurora Wikimedia Commons" with limit 2. Then spawn one subagent with role review, idempotencyKey agent-expansion-live-v4, allowedTools [list_tools], and task "List your allowed tools and explicitly state whether write_file and run_terminal are available." Wait for it and summarize both results.'
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

children=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?parentId=$parent_id")
PARENT="$parent" CHILDREN="$children" node - <<'NODE'
const parent = JSON.parse(process.env.PARENT).job;
const children = JSON.parse(process.env.CHILDREN).jobs || [];
const child = children[0];
const output = {
  parentStatus: parent?.status,
  parentError: parent?.error?.message || null,
  imageSearchExecuted: parent?.result?.executedTools?.includes("search_images"),
  reviewSpawned: child?.role === "review",
  reviewCompleted: child?.status === "completed",
  reviewReadOnly: !child?.allowedTools?.includes("write_file") && !child?.allowedTools?.includes("run_terminal"),
  evidenceStructured: Array.isArray(child?.result?.evidence),
  usageStructured: Number.isFinite(Number(child?.result?.usage?.elapsedMs))
};
console.log(JSON.stringify(output));
if (parent?.status !== "completed" || !output.imageSearchExecuted || !output.reviewSpawned || !output.reviewCompleted || !output.reviewReadOnly || !output.evidenceStructured || !output.usageStructured) process.exit(1);
NODE