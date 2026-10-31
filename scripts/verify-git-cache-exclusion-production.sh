#!/bin/sh
set -eu

cd /opt/remote-ai-access
base=http://127.0.0.1:8787
origin=https://ai.tg11.org
workspace=gage-flatsat-ws0
probe=.git-cache-exclusion-probe

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(value=>value.startsWith(prefix));if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
headers="-u $auth -H $api_header:$api_key -H x-workspace-code:$workspace -H origin:$origin"

test -d "/opt/remote-ai-access/sandbox/workspaces/$workspace/.cache/tmp.DuPc2wQaVe"
mkdir_result=$(curl -sS $headers -H 'content-type: application/json' --data "{\"path\":\"$probe\"}" "$base/api/files/mkdir")
delete_result=$(curl -sS $headers -X DELETE "$base/api/files/delete?path=$probe")

MKDIR_RESULT="$mkdir_result" DELETE_RESULT="$delete_result" node - <<'NODE'
const mkdirResult = JSON.parse(process.env.MKDIR_RESULT);
const deleteResult = JSON.parse(process.env.DELETE_RESULT);
if (mkdirResult.ok !== true || deleteResult.ok !== true) {
  console.error(JSON.stringify({ mkdirResult, deleteResult }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ mkdirSnapshot: true, deleteSnapshot: true, unreadableCacheIgnored: true }, null, 2));
NODE

systemctl is-active --quiet remote-ai-access
printf 'production git cache exclusion verified\n'