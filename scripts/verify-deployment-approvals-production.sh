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
base=http://127.0.0.1:8787
body='{"ttlMs":60000,"manifest":{"application":"approval-media","hostname":"approval-foundation.tg11.org","runtime":"static","artifactPath":"images","healthPath":"/healthz","environmentNames":[],"persistentData":false}}'

created=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H "$api_header: $api_key" -H 'x-workspace-code: debugging-media' -H 'content-type: application/json' --data "$body" "$base/api/admin/deployment-approvals")
id=$(CREATED="$created" node -e 'const value=JSON.parse(process.env.CREATED); if (!value.token || !value.approval?.id) process.exit(1); process.stdout.write(value.approval.id)')

listed=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H 'x-workspace-code: debugging-media' "$base/api/admin/deployment-approvals")
other=$(curl -fsS -u "$auth" -H "x-admin-token: $admin" -H 'x-workspace-code: default' "$base/api/admin/deployment-approvals")
revoked=$(curl -fsS -X DELETE -u "$auth" -H "x-admin-token: $admin" -H "$api_header: $api_key" -H 'x-workspace-code: debugging-media' "$base/api/admin/deployment-approvals/$id")

ID="$id" LISTED="$listed" OTHER="$other" REVOKED="$revoked" node - <<'NODE'
const id = process.env.ID;
const listed = JSON.parse(process.env.LISTED);
const other = JSON.parse(process.env.OTHER);
const revoked = JSON.parse(process.env.REVOKED);
const row = listed.approvals?.find((approval) => approval.id === id);
const output = {
  createdAndListed: Boolean(row),
  secretsOmitted: Boolean(row) && !Object.hasOwn(row, "token") && !Object.hasOwn(row, "tokenHash"),
  isolatedFromOtherWorkspace: !other.approvals?.some((approval) => approval.id === id),
  revoked: revoked.approval?.status === "revoked"
};
console.log(JSON.stringify(output, null, 2));
if (!Object.values(output).every(Boolean)) process.exit(1);
NODE