#!/bin/sh
set -eu

root=/opt/remote-ai-access
stage=/tmp/raa-docker-runtime-guard
backup="$root/.deploy-backup-docker-runtime-guard-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/server.js" "$root/src/server.js"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -f "$stage/src/server.js"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/src/server.js" "$backup/server.js"
install -o root -g root -m 0644 "$stage/src/server.js" "$root/src/server.js"

cd "$root"
node --check src/server.js
node --test tests
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$stage"
printf 'docker runtime guard active; rollback: %s\n' "$backup"