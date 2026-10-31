#!/bin/sh
set -eu

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
base=http://127.0.0.1:8787
origin=https://ai.tg11.org
name=raa-tool-control-test

docker rm -f "$name" >/dev/null 2>&1 || true
docker run -d --name "$name" --label org.remote-ai-access.tool=true node:20-bookworm sh -lc 'sleep 300' >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

listed=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H 'x-workspace-code: gage-flatsat-ws0' "$base/api/operations/tool-containers")
LISTED="$listed" node -e 'const value=JSON.parse(process.env.LISTED);if(value.count!==1||value.containers?.[0]?.name!=="raa-tool-control-test")process.exit(1)'

status=$(curl -sS -o /tmp/raa-managed-container-unconfirmed.json -w '%{http_code}' -u "$auth" -H "$api_header: $api_key" -H 'x-workspace-code: gage-flatsat-ws0' -H "origin: $origin" -H 'content-type: application/json' -X DELETE --data '{}' "$base/api/operations/tool-containers")
test "$status" = 400
docker inspect "$name" >/dev/null

removed=$(curl -fsS -u "$auth" -H "$api_header: $api_key" -H 'x-workspace-code: gage-flatsat-ws0' -H "origin: $origin" -H 'content-type: application/json' -X DELETE --data '{"confirmation":"REMOVE_MANAGED_TOOL_CONTAINERS"}' "$base/api/operations/tool-containers")
REMOVED="$removed" node -e 'const value=JSON.parse(process.env.REMOVED);if(value.removed!==1)process.exit(1)'
test "$(docker ps -aq --filter name="$name")" = ""
trap - EXIT
printf 'managed container list, confirmation gate, and cleanup verified\n'