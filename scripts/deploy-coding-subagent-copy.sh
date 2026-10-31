#!/bin/sh
set -eu

root=/opt/remote-ai-access
stage=/tmp/raa-coding-subagent-copy
backup="$root/.deploy-backup-coding-subagent-copy-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/public/app.js" "$root/public/app.js"
  cp "$backup/public/index.html" "$root/public/index.html"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$stage"
test ! -e "$backup"
mkdir -p "$backup/public"
cp "$root/public/app.js" "$backup/public/app.js"
cp "$root/public/index.html" "$backup/public/index.html"
install -o root -g root -m 0644 "$stage/public/app.js" "$root/public/app.js"
install -o root -g root -m 0644 "$stage/public/index.html" "$root/public/index.html"
node --check "$root/public/app.js"
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$stage"
printf 'coding subagent copy active; rollback: %s\n' "$backup"