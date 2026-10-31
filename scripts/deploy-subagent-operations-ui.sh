#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-subagent-operations-ui
backup="$root/.deploy-backup-subagent-operations-ui-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/server.js" "$root/src/server.js"
  cp "$backup/app.js" "$root/public/app.js"
  cp "$backup/index.html" "$root/public/index.html"
  cp "$backup/styles.css" "$root/public/styles.css"
  cp "$backup/PRODUCT_ROADMAP.md" "$root/PRODUCT_ROADMAP.md"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/src/server.js" "$backup/server.js"
cp "$root/public/app.js" "$backup/app.js"
cp "$root/public/index.html" "$backup/index.html"
cp "$root/public/styles.css" "$backup/styles.css"
cp "$root/PRODUCT_ROADMAP.md" "$backup/PRODUCT_ROADMAP.md"

install -o root -g root -m 0644 "$staging/server.js" "$root/src/server.js"
install -o root -g root -m 0644 "$staging/app.js" "$root/public/app.js"
install -o root -g root -m 0644 "$staging/index.html" "$root/public/index.html"
install -o root -g root -m 0644 "$staging/styles.css" "$root/public/styles.css"
install -o root -g root -m 0644 "$staging/PRODUCT_ROADMAP.md" "$root/PRODUCT_ROADMAP.md"

cd "$root"
node --check src/server.js
node --check public/app.js
node --test tests/subagent-policy.test.mjs tests/chat-jobs.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'subagent operations UI active; rollback: %s\n' "$backup"