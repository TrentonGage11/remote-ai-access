#!/bin/sh
set -eu

cd /opt/remote-ai-access

read_service_env() {
  node -e 'const fs=require("fs"); const cp=require("child_process"); const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim(); const entries=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0"); const prefix=`${process.argv[1]}=`; const entry=entries.find((item)=>item.startsWith(prefix)); if (!entry) process.exit(1); process.stdout.write(entry.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
admin=$(read_service_env ADMIN_DASHBOARD_TOKEN)
settings_path=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const settings=require(process.argv[1]); if (!settings.apiKeys?.[0]) process.exit(1); process.stdout.write(settings.apiKeys[0])' "$settings_path")
api_header=$(node -e 'const settings=require(process.argv[1]); process.stdout.write(settings.apiKeyHeaderName || "x-api-key")' "$settings_path")
workspace=debugging-media
application=raa-static-smoke
hostname=raa-static-smoke.tg11.org
artifact=activation-smoke-v1
artifact_root="/opt/remote-ai-access/sandbox/workspaces/$workspace/$artifact"
base=http://127.0.0.1:8787

runuser -u remote-ai-access -- node --input-type=module <<'NODE'
import net from "node:net";
const result = await new Promise((resolve, reject) => {
  const socket = net.createConnection("/run/raa-deploy/helper.sock");
  let body = "";
  socket.setEncoding("utf8");
  socket.on("connect", () => socket.end("{}"));
  socket.on("data", (chunk) => { body += chunk; });
  socket.on("end", () => resolve(JSON.parse(body)));
  socket.on("error", reject);
});
if (result.ok || !String(result.error).includes("unsupported helper action")) process.exit(1);
console.log("malformed helper request rejected");
NODE

install -d -o remote-ai-access -g remote-ai-access -m 0755 "$artifact_root"
printf '%s\n' '<!doctype html><html><body>approved-static-release-v1</body></html>' > "$artifact_root/index.html"
printf '%s\n' 'healthy-v1' > "$artifact_root/healthz"
chown remote-ai-access:remote-ai-access "$artifact_root/index.html" "$artifact_root/healthz"
chmod 0644 "$artifact_root/index.html" "$artifact_root/healthz"
echo "artifact prepared"

manifest=$(APPLICATION="$application" HOSTNAME="$hostname" ARTIFACT="$artifact" node -e 'process.stdout.write(JSON.stringify({application:process.env.APPLICATION,hostname:process.env.HOSTNAME,runtime:"static",artifactPath:process.env.ARTIFACT,healthPath:"/healthz",environmentNames:[],persistentData:false}))')
approval_body=$(MANIFEST="$manifest" node -e 'process.stdout.write(JSON.stringify({ttlMs:300000,manifest:JSON.parse(process.env.MANIFEST)}))')
created=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$approval_body" "$base/api/admin/deployment-approvals")
approval_id=$(CREATED="$created" node -e 'process.stdout.write(JSON.parse(process.env.CREATED).approval?.id || "")')
approval_token=$(CREATED="$created" node -e 'process.stdout.write(JSON.parse(process.env.CREATED).token || "")')
test -n "$approval_id"
test -n "$approval_token"
echo "approval created"

xai_key=$(read_service_env XAI_API_KEY 2>/dev/null || true)
openai_key=$(read_service_env OPENAI_API_KEY 2>/dev/null || true)
if test -n "$xai_key"; then
  provider=xai
  model=$(read_service_env XAI_MODEL 2>/dev/null || printf '%s' 'grok-4.6')
elif test -n "$openai_key"; then
  provider=openai
  model=$(read_service_env OPENAI_MODEL 2>/dev/null || printf '%s' 'gpt-4.1')
else
  provider=google
  model=$(read_service_env GOOGLE_MODEL 2>/dev/null || printf '%s' 'gemini-3.7-flash')
fi

prompt=$(APPROVAL_ID="$approval_id" APPROVAL_TOKEN="$approval_token" MANIFEST="$manifest" node -e 'process.stdout.write(`Call deploy_application exactly once with action activate, approvalId ${process.env.APPROVAL_ID}, approvalToken ${process.env.APPROVAL_TOKEN}, and manifest ${process.env.MANIFEST}. Do not call another tool. Report the structured result.`)')
chat_body=$(PROVIDER="$provider" MODEL="$model" PROMPT="$prompt" node -e 'process.stdout.write(JSON.stringify({provider:process.env.PROVIDER,model:process.env.MODEL,agentMode:true,toolProfile:"deployment",messages:[{role:"user",content:process.env.PROMPT}]}))')
chat_response=$(mktemp)
trap 'rm -f "$chat_response"' EXIT
chat_status=$(curl -sS -o "$chat_response" -w '%{http_code}' -u "$auth" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -H 'content-type: application/json' --data "$chat_body" "$base/api/chat")
if test "$chat_status" != 200; then
  STATUS="$chat_status" RESPONSE_FILE="$chat_response" node -e 'const fs=require("fs"); let body={}; try { body=JSON.parse(fs.readFileSync(process.env.RESPONSE_FILE,"utf8")); } catch {} console.error(JSON.stringify({status:process.env.STATUS,error:body.error||"request failed",traceId:body.traceId||null}));'
  exit 1
fi
result=$(cat "$chat_response")
rm -f "$chat_response"
trap - EXIT
echo "agent activation returned"

listed=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H "x-workspace-code: $workspace" "$base/api/admin/deployment-approvals")
approval_status=$(LISTED="$listed" APPROVAL_ID="$approval_id" node -e 'const value=JSON.parse(process.env.LISTED).approvals?.find(function(item){return item.id===process.env.APPROVAL_ID});if(value?.status!=="consumed"){console.error(JSON.stringify({status:value?.status||"missing",failure:value?.failure||null}));process.exit(1)}process.stdout.write(value.status)')
test "$approval_status" = consumed
echo "approval consumed"

tls_pin=$(node -e 'const fs=require("fs");const crypto=require("crypto");const cert=new crypto.X509Certificate(fs.readFileSync("/etc/apache2/ssl/tg11.org.pem"));process.stdout.write(`sha256//${crypto.createHash("sha256").update(cert.publicKey.export({type:"spki",format:"der"})).digest("base64")}`)')
served=$(curl -fsS --insecure --pinnedpubkey "$tls_pin" --resolve "$hostname:443:127.0.0.1" "https://$hostname/")
health=$(curl -fsS --insecure --pinnedpubkey "$tls_pin" --resolve "$hostname:443:127.0.0.1" "https://$hostname/healthz")
echo "https and approval state fetched"

RESULT="$result" LISTED="$listed" APPROVAL_ID="$approval_id" APPLICATION="$application" HOSTNAME="$hostname" SERVED="$served" HEALTH="$health" node - <<'NODE'
const result = JSON.parse(process.env.RESULT);
const listed = JSON.parse(process.env.LISTED);
const approval = listed.approvals?.find((item) => item.id === process.env.APPROVAL_ID);
const registry = JSON.parse(require("fs").readFileSync("/var/lib/raa-deploy/registry.json", "utf8"));
const app = registry.applications?.[process.env.APPLICATION];
const output = {
  completed: Array.isArray(result.executedTools) && result.executedTools.length === 1 && result.executedTools[0] === "deploy_application",
  approvalConsumed: approval?.status === "consumed" && Boolean(approval?.releaseId),
  registryActive: app?.hostname === process.env.HOSTNAME && app?.currentRelease === approval?.releaseId,
  indexServed: process.env.SERVED.includes("approved-static-release-v1"),
  healthPassed: process.env.HEALTH.trim() === "healthy-v1"
};
console.log(JSON.stringify(output, null, 2));
if (!Object.values(output).every(Boolean)) process.exit(1);
NODE