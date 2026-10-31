#!/bin/sh
set -eu

test "$#" -eq 2 || { echo "usage: $0 WORKSPACE SUBAGENT_ID" >&2; exit 2; }
workspace=$1
child_id=$2
base=http://127.0.0.1:8787
origin=https://ai.tg11.org
cookie_jar=$(mktemp)

cleanup() {
  rm -f "$cookie_jar"
}
trap cleanup EXIT

read_service_env() {
  node -e 'const fs=require("fs");const cp=require("child_process");const pid=cp.execFileSync("systemctl",["show","remote-ai-access","-p","MainPID","--value"],{encoding:"utf8"}).trim();const values=fs.readFileSync(`/proc/${pid}/environ`).toString().split("\0");const prefix=`${process.argv[1]}=`;const found=values.find(function(value){return value.startsWith(prefix)});if(!found)process.exit(1);process.stdout.write(found.slice(prefix.length))' "$1"
}

auth_user=$(read_service_env BASIC_AUTH_USER)
auth_pass=$(read_service_env BASIC_AUTH_PASS)
settings=/opt/remote-ai-access/sandbox/_admin/settings-db.json
api_key=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeys[0])' "$settings")
api_header=$(node -e 'const value=require(process.argv[1]);process.stdout.write(value.apiKeyHeaderName||"x-api-key")' "$settings")

curl -fsS -c "$cookie_jar" -o /dev/null -H "origin: $origin" --data-urlencode "username=$auth_user" --data-urlencode "password=$auth_pass" --data-urlencode 'next=/' "$base/basic-auth"
session_cookie=$(awk '$6 == "raa_basic_session" { print $7 }' "$cookie_jar")
test -n "$session_cookie"
curl -fsS -b "raa_basic_session=$session_cookie" -H "origin: $origin" -H "$api_header: $api_key" -H "x-workspace-code: $workspace" -X POST "$base/api/chat/subagents/$child_id/approve"