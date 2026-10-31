#!/bin/sh
set -eu

cd /opt/remote-ai-access

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth_user=$(read_service_env BASIC_AUTH_USER)
auth_pass=$(read_service_env BASIC_AUTH_PASS)
auth="$auth_user:$auth_pass"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
workspace=debugging-media
workspace_root="/opt/remote-ai-access/sandbox/workspaces/$workspace"
base=http://127.0.0.1:8787
origin=https://ai.tg11.org
stamp=$(date +%s)
artifact="agent-tests/coding-subagent-smoke-$stamp.txt"
absolute="$workspace_root/$artifact"
cookie_jar="/tmp/raa-coding-cookie-$stamp.txt"

cleanup() {
  rm -f "$absolute" "$cookie_jar"
}
trap cleanup EXIT

if xai_key=$(read_service_env XAI_API_KEY 2>/dev/null) && test -n "$xai_key"; then
  provider=xai
  model=$(read_service_env XAI_MODEL 2>/dev/null || printf '%s' grok-4.6)
elif openai_key=$(read_service_env OPENAI_API_KEY 2>/dev/null) && test -n "$openai_key"; then
  provider=openai
  model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' gpt-4.1)
else
  provider=google
  model=$(read_service_env GOOGLE_MODEL 2>/dev/null || printf '%s' gemini-3.7-flash)
fi

prompt="Call spawn_subagent exactly once with idempotencyKey coding-smoke-$stamp, role coding, allowedTools [read_file, write_file], allowedPaths [$artifact], and task: write exactly 'approved coding child smoke' followed by a newline to $artifact, then report the tool result. Do not call wait_subagents."
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

children=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?parentId=$parent_id")
child_id=$(CHILDREN="$children" node -e 'const value=JSON.parse(process.env.CHILDREN);const child=value.jobs?.find(item=>item.role==="coding");process.stdout.write(child?.id||"")')
before_status=$(CHILDREN="$children" CHILD_ID="$child_id" node -e 'const value=JSON.parse(process.env.CHILDREN);process.stdout.write(value.jobs?.find(item=>item.id===process.env.CHILD_ID)?.status||"")')
test -n "$child_id"
test "$before_status" = awaiting_approval
test ! -e "$absolute"

self_approve_status=$(curl -sS -o /dev/null -w '%{http_code}' -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -X POST "$base/api/chat/subagents/$child_id/approve")
test "$self_approve_status" = 403

curl -fsS -c "$cookie_jar" -o /dev/null -H "origin: $origin" --data-urlencode "username=$auth_user" --data-urlencode "password=$auth_pass" --data-urlencode 'next=/' "$base/basic-auth"
session_cookie=$(awk '$6 == "raa_basic_session" { print $7 }' "$cookie_jar")
test -n "$session_cookie"
curl -fsS -o /dev/null -b "raa_basic_session=$session_cookie" -H "origin: $origin" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -X POST "$base/api/chat/subagents/$child_id/approve"

attempt=0
while test "$attempt" -lt 180; do
  children=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?parentId=$parent_id")
  child_status=$(CHILDREN="$children" CHILD_ID="$child_id" node -e 'const value=JSON.parse(process.env.CHILDREN);process.stdout.write(value.jobs?.find(item=>item.id===process.env.CHILD_ID)?.status||"")')
  case "$child_status" in completed|failed|cancelled) break ;; esac
  attempt=$((attempt + 1))
  sleep 1
done

test "$child_status" = completed
test "$(cat "$absolute")" = "approved coding child smoke"
git_status=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/files/git/status")
git_state=$(GIT_STATUS="$git_status" ARTIFACT="$artifact" node -e 'const value=JSON.parse(process.env.GIT_STATUS);const file=value.files?.find(item=>item.path===process.env.ARTIFACT);if(!file)process.exit(1);process.stdout.write(JSON.stringify(file))')

acceptance_body=$(ARTIFACT="$artifact" node -e 'process.stdout.write(JSON.stringify({artifacts:{[process.env.ARTIFACT]:"accepted"}}))')
accepted=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H "origin: $origin" -H 'content-type: application/json' -X PATCH --data "$acceptance_body" "$base/api/chat/subagents/$child_id/acceptance")

PARENT_STATUS="$parent_status" BEFORE_STATUS="$before_status" CHILD_STATUS="$child_status" SELF_APPROVE_STATUS="$self_approve_status" CHILDREN="$children" ACCEPTED="$accepted" ARTIFACT="$artifact" GIT_STATE="$git_state" node - <<'NODE'
const children = JSON.parse(process.env.CHILDREN);
const accepted = JSON.parse(process.env.ACCEPTED);
const child = children.jobs?.find((item) => item.role === "coding");
const output = {
  parentCompleted: process.env.PARENT_STATUS === "completed",
  awaitedHumanApproval: process.env.BEFORE_STATUS === "awaiting_approval",
  apiKeyCannotSelfApprove: process.env.SELF_APPROVE_STATUS === "403",
  childCompleted: process.env.CHILD_STATUS === "completed",
  exactPathBound: child?.allowedPaths?.length === 1 && child.allowedPaths[0] === process.env.ARTIFACT,
  writeExecuted: child?.result?.executedTools?.includes("write_file"),
  artifactDeclared: child?.result?.artifacts?.some((item) => item.path === process.env.ARTIFACT),
  artifactAccepted: accepted.acceptance?.artifacts?.[process.env.ARTIFACT] === "accepted",
  leftForGitReview: JSON.parse(process.env.GIT_STATE || "{}").path === process.env.ARTIFACT
};
console.log(JSON.stringify(output));
if (!Object.values(output).every(Boolean)) process.exit(1);
NODE