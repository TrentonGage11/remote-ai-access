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
base=http://127.0.0.1:8787

for workspace_path in sandbox/workspaces/*; do
  test -d "$workspace_path" || continue
  workspace=$(basename "$workspace_path")
  response=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" "$base/api/chat/subagents?status=awaiting_approval")
  WORKSPACE="$workspace" RESPONSE="$response" node - <<'NODE'
const value = JSON.parse(process.env.RESPONSE);
for (const job of value.jobs || []) {
  if (job.role !== "coding") continue;
  console.log(JSON.stringify({
    workspace: process.env.WORKSPACE,
    id: job.id,
    parentId: job.parentId,
    task: job.task,
    allowedTools: job.allowedTools,
    allowedPaths: job.allowedPaths,
    createdAt: job.createdAt
  }));
}
NODE
done