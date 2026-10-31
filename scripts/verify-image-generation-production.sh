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
generation_provider=${1:-openai}
case "$generation_provider" in openai|xai) ;; *) echo "provider must be openai or xai" >&2; exit 2 ;; esac
provider=openai
model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' gpt-4.1)
output_path="agent-tests/image-generation-$generation_provider-smoke.png"
idempotency_key="image-generation-$generation_provider-live-v1"

prompt="Spawn one subagent with role image, idempotencyKey $idempotency_key, allowedTools [generate_image], provider openai, and task \"Call generate_image exactly once with provider $generation_provider, prompt: a simple flat green circle centered on a transparent background, outputPath: $output_path, size: 1024x1024, quality: low. Report the saved path.\" Wait for it and report the result."
body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"standard",messages:[{role:"user",content:process.env.PROMPT}]}))')
started=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$body" "$base/api/chat/jobs")
parent_id=$(STARTED="$started" node -e 'process.stdout.write(JSON.parse(process.env.STARTED).job?.id||"")')
test -n "$parent_id"

attempt=0
while test "$attempt" -lt 600; do
  parent=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/jobs/$parent_id")
  status=$(PARENT="$parent" node -e 'process.stdout.write(JSON.parse(process.env.PARENT).job?.status||"")')
  case "$status" in completed|failed|cancelled) break ;; esac
  attempt=$((attempt + 1))
  sleep 1
done

children=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?parentId=$parent_id")
child_id=$(CHILDREN="$children" node -e 'process.stdout.write((JSON.parse(process.env.CHILDREN).jobs||[])[0]?.id||"")')
test -n "$child_id"
acceptance_body=$(OUTPUT_PATH="$output_path" node -e 'process.stdout.write(JSON.stringify({artifacts:{[process.env.OUTPUT_PATH]:"accepted"}}))')
acceptance=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' -X PATCH --data "$acceptance_body" "$base/api/chat/subagents/$child_id/acceptance")
PARENT="$parent" CHILDREN="$children" ACCEPTANCE="$acceptance" OUTPUT_PATH="$output_path" node - <<'NODE'
const parent = JSON.parse(process.env.PARENT).job;
const child = (JSON.parse(process.env.CHILDREN).jobs || [])[0];
const acceptance = JSON.parse(process.env.ACCEPTANCE).acceptance;
const artifact = (child?.result?.artifacts || []).find((item) => item.path === process.env.OUTPUT_PATH);
const output = {
  parentStatus: parent?.status,
  parentError: parent?.error?.message || null,
  imageRole: child?.role === "image",
  childStatus: child?.status,
  childError: child?.error?.message || null,
  generationExecuted: child?.result?.executedTools?.includes("generate_image") || false,
  allowedTools: child?.allowedTools || [],
  executedTools: child?.result?.executedTools || [],
  artifactDeclared: Boolean(artifact),
  artifactAccepted: acceptance?.artifacts?.[process.env.OUTPUT_PATH] === "accepted",
  summary: String(child?.result?.summary || "").slice(0, 500),
  eventTypes: (child?.events || []).slice(-12).map((event) => event.type)
};
console.log(JSON.stringify(output));
if (parent?.status !== "completed" || child?.status !== "completed" || !output.generationExecuted || !output.artifactDeclared || !output.artifactAccepted) process.exit(1);
NODE

test -s "/opt/remote-ai-access/sandbox/workspaces/$workspace/$output_path"
stat -c '%s' "/opt/remote-ai-access/sandbox/workspaces/$workspace/$output_path"