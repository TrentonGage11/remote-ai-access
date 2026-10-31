#!/bin/sh
set -eu

root=/opt/remote-ai-access
staged=/tmp/raa-security-admin-cache.html
backup="$root/.deploy-backup-security-admin-cache-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/security-admin.html" "$root/public/security-admin.html"
}
trap restore EXIT

test -f "$staged"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/public/security-admin.html" "$backup/security-admin.html"
install -o root -g root -m 0644 "$staged" "$root/public/security-admin.html"
grep -q 'security-admin.js?v=20260829a' "$root/public/security-admin.html"

failed=0
trap - EXIT
rm -f "$staged"
printf 'security admin cache update active; rollback: %s\n' "$backup"