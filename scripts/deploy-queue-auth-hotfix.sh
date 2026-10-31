#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-queue-auth-hotfix
backup="$root/.deploy-backup-queue-auth-hotfix-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  install -o root -g root -m 0644 "$backup/server.js" "$root/src/server.js"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -f "$staging/server.js"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/src/server.js" "$backup/server.js"
install -o root -g root -m 0644 "$staging/server.js" "$root/src/server.js"

cd "$root"
node --check src/server.js
node --test tests/chat-job-persistence.test.mjs tests/agent-policy.test.mjs tests/subagent-policy.test.mjs tests/image-tools.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'queue auth hotfix active; rollback: %s\n' "$backup"