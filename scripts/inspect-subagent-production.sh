#!/bin/sh
set -eu

test "$#" -eq 2 || { echo "usage: $0 WORKSPACE SUBAGENT_ID" >&2; exit 2; }
workspace=$1
child_id=$2

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" http://127.0.0.1:8787/api/chat/subagents \
  | CHILD_ID="$child_id" node -e '
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const job = value.jobs?.find((item) => item.id === process.env.CHILD_ID);
if (!job) process.exit(2);
console.log(JSON.stringify({
  id: job.id,
  status: job.status,
  limits: job.limits,
  error: job.error,
  executedTools: job.result?.executedTools || [],
  artifacts: job.result?.artifacts || [],
  summary: job.result?.summary || "",
  latestEvents: (job.events || []).slice(-8)
}));
});'