#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-git-cache-exclusion
backup="$root/.deploy-backup-git-cache-exclusion-v3"
files='src/server.js src/git-change-center.js tests/git-change-center.test.mjs'
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  while IFS= read -r file; do
    test -n "$file" || continue
    install -D -o root -g root -m 0644 "$backup/$file" "$root/$file"
  done < "$backup/files.txt"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup"
printf '%s\n' "$files" | tr ' ' '\n' > "$backup/files.txt"

while IFS= read -r file; do
  test -n "$file" || continue
  test -f "$root/$file"
  test -f "$staging/$file"
  mkdir -p "$backup/$(dirname "$file")"
  cp "$root/$file" "$backup/$file"
  install -D -o root -g root -m 0644 "$staging/$file" "$root/$file"
done < "$backup/files.txt"

cd "$root"
node --check src/server.js
node --check src/git-change-center.js
node --test tests/git-change-center.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'git cache exclusion active; rollback: %s\n' "$backup"