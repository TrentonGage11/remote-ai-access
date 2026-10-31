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
workspace=gage-flatsat-ws0
base=http://127.0.0.1:8787
origin=https://ai.tg11.org
stamp=$(date +%s)

if openai_key=$(read_service_env OPENAI_API_KEY 2>/dev/null) && test -n "$openai_key"; then
  provider=openai
  model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' gpt-5.6-sol)
elif xai_key=$(read_service_env XAI_API_KEY 2>/dev/null) && test -n "$xai_key"; then
  provider=xai
  model=$(read_service_env XAI_MODEL 2>/dev/null || printf '%s' grok-4.6)
else
  provider=google
  model=$(read_service_env GOOGLE_MODEL 2>/dev/null || printf '%s' gemini-3.7-flash)
fi

task='Audit and repair the entire ORBIT package at /orbit. Reproduce `python3 -m orbit web` ImportError involving missing main and SessionStore.list_events. Check every Python file for import correctness, missing referenced modules/functions/classes/attributes, all documented module entrypoints, compile/import smoke tests, and relevant tests. Fix issues directly only under orbit/ and tests/ as needed. Preserve orbit/data user data and avoid changing unrelated projects. Add practical regression tests. Report files changed, root causes, and test results.'
prompt=$(TASK="$task" STAMP="$stamp" node -e 'process.stdout.write(`Call spawn_subagent exactly once with idempotencyKey orbit-repair-retry-${process.env.STAMP}, role coding, allowedTools [list_directory, read_file, search_workspace, write_file, run_tests], allowedPaths [orbit, tests], and task: ${process.env.TASK} Do not call wait_subagents.`)')
body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"full",messages:[{role:"user",content:process.env.PROMPT}]}))')
started=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$body" "$base/api/chat/jobs")
parent_id=$(STARTED="$started" node -e 'process.stdout.write(JSON.parse(process.env.STARTED).job?.id||"")')
test -n "$parent_id"

attempt=0
while test "$attempt" -lt 180; do
  parent=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/jobs/$parent_id")
  parent_status=$(PARENT="$parent" node -e 'process.stdout.write(JSON.parse(process.env.PARENT).job?.status||"")')
  case "$parent_status" in completed|failed|cancelled) break ;; esac
  attempt=$((attempt + 1))
  sleep 1
done
test "$parent_status" = completed

children=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?parentId=$parent_id")
child_id=$(CHILDREN="$children" node -e 'const value=JSON.parse(process.env.CHILDREN);process.stdout.write(value.jobs?.find(item=>item.role==="coding")?.id||"")')
test -n "$child_id"
CHILDREN="$children" CHILD_ID="$child_id" node -e 'const value=JSON.parse(process.env.CHILDREN);const child=value.jobs?.find(item=>item.id===process.env.CHILD_ID);if(child?.status!=="awaiting_approval")process.exit(1);if(JSON.stringify(child.allowedPaths)!==JSON.stringify(["orbit/","tests/"]))process.exit(1)'

approved=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H "origin: $origin" -X POST "$base/api/chat/subagents/$child_id/approve")
PARENT_ID="$parent_id" CHILD_ID="$child_id" APPROVED="$approved" node -e 'const value=JSON.parse(process.env.APPROVED);console.log(JSON.stringify({parentId:process.env.PARENT_ID,childId:process.env.CHILD_ID,status:value.job?.status,allowedPaths:value.job?.allowedPaths,allowedTools:value.job?.allowedTools,httpBasicApproval:true}));if(!["queued","running"].includes(value.job?.status))process.exit(1)'