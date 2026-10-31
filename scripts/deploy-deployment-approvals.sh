#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-deployment-approvals
backup="$root/.deploy-backup-deployment-approvals-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/server.js" "$root/src/server.js"
  cp "$backup/.env" "$root/.env"
  test ! -f "$backup/deployment-approval.js" || cp "$backup/deployment-approval.js" "$root/src/deployment-approval.js"
  test -f "$backup/deployment-approval.js" || rm -f "$root/src/deployment-approval.js"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/src/server.js" "$backup/server.js"
cp "$root/.env" "$backup/.env"
test ! -f "$root/src/deployment-approval.js" || cp "$root/src/deployment-approval.js" "$backup/deployment-approval.js"

install -m 0644 "$staging/server.js" "$root/src/server.js"
install -m 0644 "$staging/deployment-approval.js" "$root/src/deployment-approval.js"
install -m 0644 "$staging/deployment-approval.test.mjs" "$root/tests/deployment-approval.test.mjs"
install -m 0644 "$staging/.env.example" "$root/.env.example"
install -m 0644 "$staging/AGENT_DEPLOYMENT_PROFILE.md" "$root/AGENT_DEPLOYMENT_PROFILE.md"
install -m 0644 "$staging/PRODUCT_ROADMAP.md" "$root/PRODUCT_ROADMAP.md"

if grep -q '^DEPLOYMENT_APPROVAL_DB_PATH=' "$root/.env"; then
  sed -i 's|^DEPLOYMENT_APPROVAL_DB_PATH=.*|DEPLOYMENT_APPROVAL_DB_PATH=./sandbox/_admin/deployment-approvals.json|' "$root/.env"
else
  printf '\nDEPLOYMENT_APPROVAL_DB_PATH=./sandbox/_admin/deployment-approvals.json\n' >> "$root/.env"
fi

cd "$root"
node --check src/server.js
node --test tests/deployment-approval.test.mjs tests/deployment-policy.test.mjs tests/agent-policy.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'deployment approvals active; rollback: %s\n' "$backup"