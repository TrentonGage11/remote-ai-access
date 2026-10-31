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
cookie=$(mktemp)
trap 'rm -f "$cookie"' EXIT

unauth=$(curl -sS -o /dev/null -w '%{http_code}' "$base/")
login_page=$(curl -sS -o /dev/null -w '%{http_code}' "$base/basic-auth")
login=$(curl -sS -o /dev/null -w '%{http_code}' -c "$cookie" -H 'content-type: application/x-www-form-urlencoded' --data-urlencode "username=$(read_service_env BASIC_AUTH_USER)" --data-urlencode "password=$(read_service_env BASIC_AUTH_PASS)" --data-urlencode 'returnTo=/operations.html' "$base/basic-auth")
cookie_page=$(curl -sS -o /dev/null -w '%{http_code}' -b "$cookie" "$base/operations.html")

git=$(curl -fsS -u "$auth" -H "$api_header: $api_key" "$base/api/files/git/status")
health1=$(curl -fsS -u "$auth" -H "$api_header: $api_key" "$base/api/operations/health")
health2=$(curl -fsS -u "$auth" -H "$api_header: $api_key" "$base/api/operations/health")
usage_probe=$(curl -sS -o /dev/null -w '%{http_code}' -u "$auth" -H "$api_header: $api_key" -H 'content-type: application/json' --data '{"provider":"verification-invalid","messages":[{"role":"user","content":"usage ledger write probe"}]}' "$base/api/chat")
usage=$(curl -fsS -u "$auth" -H "$api_header: $api_key" "$base/api/usage?period=month")
shares=$(curl -fsS -u "$auth" -H "$api_header: $api_key" "$base/api/files/shares")

UNAUTH="$unauth" LOGIN_PAGE="$login_page" LOGIN="$login" COOKIE_PAGE="$cookie_page" USAGE_PROBE="$usage_probe" GIT="$git" HEALTH1="$health1" HEALTH2="$health2" USAGE="$usage" SHARES="$shares" node - <<'NODE'
const git = JSON.parse(process.env.GIT);
const health1 = JSON.parse(process.env.HEALTH1);
const health2 = JSON.parse(process.env.HEALTH2);
const usage = JSON.parse(process.env.USAGE);
const shares = JSON.parse(process.env.SHARES);
const checks = {
  unauthenticatedProtected: process.env.UNAUTH === "401",
  loginPagePublic: process.env.LOGIN_PAGE === "200",
  formLoginRedirects: process.env.LOGIN === "303",
  sessionCookieWorks: process.env.COOKIE_PAGE === "200",
  gitStatusStructured: typeof git.branch === "string" && Array.isArray(git.files) && Array.isArray(git.branches),
  runtimeMetrics: Boolean(health2.metrics?.process) && Array.isArray(health2.history) && health2.history.length >= health1.history.length,
  usageFailureRecorded: process.env.USAGE_PROBE === "400" && usage.entries?.some(entry => entry.provider === "verification-invalid" && entry.ok === false),
  usageSummary: usage.period === "month" && Number.isInteger(usage.totals?.requests) && Array.isArray(usage.daily),
  shareAnalytics: Array.isArray(shares.shares) && shares.shares.every(share => "viewCount" in share && "downloadCount" in share && "expiryStatus" in share)
};
console.log(JSON.stringify(checks, null, 2));
if (!Object.values(checks).every(Boolean)) process.exit(1);
NODE

for page in git-change-center.html operations.html usage.html; do
  curl -fsS -u "$auth" "$base/$page" >/dev/null
  curl -fsS -u "$auth" "https://ai.tg11.org/$page" >/dev/null
done
systemctl is-active --quiet remote-ai-access
printf 'production operations batch verified\n'