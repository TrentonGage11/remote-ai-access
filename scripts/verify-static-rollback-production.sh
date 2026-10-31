#!/bin/sh
set -eu

cd /opt/remote-ai-access

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
admin=$(read_service_env ADMIN_DASHBOARD_TOKEN)
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
workspace=debugging-media
application=raa-static-smoke
hostname=raa-static-smoke.tg11.org
base=http://127.0.0.1:8787
xai_key=$(read_service_env XAI_API_KEY 2>/dev/null || true)
openai_key=$(read_service_env OPENAI_API_KEY 2>/dev/null || true)
if test -n "$xai_key"; then provider=xai; model=$(read_service_env XAI_MODEL 2>/dev/null || printf '%s' grok-4.6)
elif test -n "$openai_key"; then provider=openai; model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' gpt-4.1)
else provider=google; model=$(read_service_env GOOGLE_MODEL 2>/dev/null || printf '%s' gemini-3.7-flash)
fi

invoke_deployment() {
  action=$1
  manifest=$2
  echo "$action approval requested" >&2
  approval_body=$(ACTION="$action" MANIFEST="$manifest" node -e 'process.stdout.write(JSON.stringify({action:process.env.ACTION,ttlMs:300000,manifest:JSON.parse(process.env.MANIFEST)}))')
  created=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$approval_body" "$base/api/admin/deployment-approvals")
  approval_id=$(CREATED="$created" node -e 'process.stdout.write(JSON.parse(process.env.CREATED).approval.id)')
  approval_token=$(CREATED="$created" node -e 'process.stdout.write(JSON.parse(process.env.CREATED).token)')
  echo "$action approval created" >&2
  prompt=$(ACTION="$action" APPROVAL_ID="$approval_id" APPROVAL_TOKEN="$approval_token" MANIFEST="$manifest" node -e 'process.stdout.write(`Call deploy_application exactly once with action ${process.env.ACTION}, approvalId ${process.env.APPROVAL_ID}, approvalToken ${process.env.APPROVAL_TOKEN}, and manifest ${process.env.MANIFEST}. Do not call another tool. Report the structured result.`)')
  body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"deployment",messages:[{role:"user",content:process.env.PROMPT}]}))')
  result=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$body" "$base/api/chat")
  echo "$action agent returned" >&2
  listed=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H "x-workspace-code: $workspace" "$base/api/admin/deployment-approvals")
  RESULT="$result" LISTED="$listed" APPROVAL_ID="$approval_id" node -e 'const result=JSON.parse(process.env.RESULT);const approval=JSON.parse(process.env.LISTED).approvals.find(function(item){return item.id===process.env.APPROVAL_ID});if(result.executedTools?.length!==1||result.executedTools[0]!=="deploy_application"||approval?.status!=="consumed"||!approval.releaseId){console.error(JSON.stringify({executedTools:result.executedTools||[],approvalStatus:approval?.status||"missing",failure:approval?.failure||null}));process.exit(1)}process.stdout.write(approval.releaseId)'
}

original_release=$(node -e 'const value=require("/var/lib/raa-deploy/registry.json").applications[process.argv[1]];if(!value?.currentRelease)process.exit(1);process.stdout.write(value.currentRelease)' "$application")
tls_pin=$(node -e 'const fs=require("fs");const crypto=require("crypto");const cert=new crypto.X509Certificate(fs.readFileSync("/etc/apache2/ssl/tg11.org.pem"));process.stdout.write(`sha256//${crypto.createHash("sha256").update(cert.publicKey.export({type:"spki",format:"der"})).digest("base64")}`)')
original_content=$(curl -fsS --insecure --pinnedpubkey "$tls_pin" --resolve "$hostname:443:127.0.0.1" "https://$hostname/")
echo "original release captured"
artifact=activation-smoke-v2
artifact_root="/opt/remote-ai-access/sandbox/workspaces/$workspace/$artifact"
install -d -o remote-ai-access -g remote-ai-access -m 0755 "$artifact_root"
printf '%s\n' '<!doctype html><html><body>approved-static-release-v2</body></html>' > "$artifact_root/index.html"
printf '%s\n' 'healthy-v2' > "$artifact_root/healthz"
chown remote-ai-access:remote-ai-access "$artifact_root/index.html" "$artifact_root/healthz"
chmod 0644 "$artifact_root/index.html" "$artifact_root/healthz"
manifest=$(APPLICATION="$application" HOSTNAME="$hostname" ARTIFACT="$artifact" node -e 'process.stdout.write(JSON.stringify({application:process.env.APPLICATION,hostname:process.env.HOSTNAME,runtime:"static",artifactPath:process.env.ARTIFACT,healthPath:"/healthz",environmentNames:[],persistentData:false}))')

v2_release=$(invoke_deployment activate "$manifest")
echo "v2 activation consumed"
v2_content=$(curl -fsS --insecure --pinnedpubkey "$tls_pin" --resolve "$hostname:443:127.0.0.1" "https://$hostname/")
printf '%s' "$v2_content" | grep -q approved-static-release-v2
echo "v2 content served"

rollback_release=$(invoke_deployment rollback "$manifest")
echo "rollback consumed"
rolled_back_content=$(curl -fsS --insecure --pinnedpubkey "$tls_pin" --resolve "$hostname:443:127.0.0.1" "https://$hostname/")

ORIGINAL="$original_release" ORIGINAL_CONTENT="$original_content" V2="$v2_release" ROLLBACK="$rollback_release" CONTENT="$rolled_back_content" APPLICATION="$application" node - <<'NODE'
const registry = require("/var/lib/raa-deploy/registry.json").applications[process.env.APPLICATION];
const output = {
  distinctSecondRelease: process.env.V2 !== process.env.ORIGINAL,
  rollbackSelectedPriorRelease: process.env.ROLLBACK === process.env.ORIGINAL,
  registryRestoredPriorRelease: registry.currentRelease === process.env.ORIGINAL,
  registryTracksRolledBackRelease: registry.previousRelease === process.env.V2,
  priorContentRestored: process.env.CONTENT === process.env.ORIGINAL_CONTENT,
  registryMarksRollback: registry.lastAction === "rollback"
};
console.log(JSON.stringify(output, null, 2));
if (!Object.values(output).every(Boolean)) process.exit(1);
NODE