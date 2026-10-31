#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-static-rollback
backup="$root/.deploy-backup-static-rollback-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/server.js" "$root/src/server.js"
  cp "$backup/deployment-approval.js" "$root/src/deployment-approval.js"
  cp "$backup/deployment-helper.js" "$root/src/deployment-helper.js"
  cp "$backup/deployment-helper-policy.js" "$root/src/deployment-helper-policy.js"
  systemctl restart raa-deploy-helper.service || true
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup"
for file in server.js deployment-approval.js deployment-helper.js deployment-helper-policy.js; do
  cp "$root/src/$file" "$backup/$file"
  install -o root -g root -m 0644 "$staging/$file" "$root/src/$file"
done
install -o root -g root -m 0644 "$staging/deployment-approval.test.mjs" "$root/tests/deployment-approval.test.mjs"
install -o root -g root -m 0644 "$staging/deployment-helper-policy.test.mjs" "$root/tests/deployment-helper-policy.test.mjs"

cd "$root"
node --check src/server.js
node --check src/deployment-helper.js
node --test tests/deployment-approval.test.mjs tests/deployment-helper-policy.test.mjs tests/deployment-policy.test.mjs tests/agent-policy.test.mjs
systemctl restart raa-deploy-helper.service
systemctl restart remote-ai-access
systemctl is-active --quiet raa-deploy-helper.service
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'static rollback active; rollback: %s\n' "$backup"