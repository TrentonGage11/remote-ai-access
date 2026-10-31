#!/bin/sh
set -eu

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth="$(read_service_env BASIC_AUTH_USER):$(read_service_env BASIC_AUTH_PASS)"
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")
body='{"command":"yes x | head -c 2000000","cwd":"","timeoutMs":30000}'

curl -fsS -u "$auth" -H "$api_header: $api_key" -H 'x-workspace-code: gage-flatsat-ws0' -H 'content-type: application/json' --data "$body" http://127.0.0.1:8787/api/files/terminal >/tmp/raa-docker-guard-response.json
test "$(docker ps -aq --filter name=raa-tool-)" = ""
find /var/lib/docker/containers -type f -name '*-json.log' -size +100M -print -quit | grep -q . && exit 1
df -h /
printf 'managed tool containers cleaned after output overflow\n'