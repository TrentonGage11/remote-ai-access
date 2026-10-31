#!/bin/sh
set -eu

cd /opt/remote-ai-access
base=http://127.0.0.1:8787

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(value=>value.startsWith(prefix));if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
response=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H 'content-type: application/json' -H 'origin: https://ai.tg11.org' --data '{"provider":"google","model":"gemini-3.7-flash","agentMode":true,"messages":[{"role":"user","content":"Reply with exactly: scope-ok"}]}' "$base/api/chat")

RESPONSE="$response" node - <<'NODE'
const response = JSON.parse(process.env.RESPONSE);
const checks = {
  googleAgentCompleted: response.provider === "google" && response.agentMode === true,
  noScopeError: !/protectedConversationCount is not defined/i.test(String(response.error || response.reply || ""))
};
console.log(JSON.stringify(checks, null, 2));
if (!Object.values(checks).every(Boolean)) process.exit(1);
NODE

systemctl is-active --quiet remote-ai-access
printf 'production Google agent scope verified\n'