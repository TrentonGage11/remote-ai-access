#!/bin/sh
set -eu

root=/opt/remote-ai-access
stage=/tmp/raa-subagent-budgets
backup="$root/.deploy-backup-subagent-budgets-v2"
failed=1
files='src/server.js src/subagent-policy.js tests/subagent-policy.test.mjs SUBAGENTS.md README.md'

restore() {
  test "$failed" -eq 1 || return 0
  while IFS= read -r file; do
    test -n "$file" || continue
    cp "$backup/original/$file" "$root/$file"
  done < "$backup/files.txt"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$stage"
test ! -e "$backup"
mkdir -p "$backup/original"
printf '%s\n' "$files" | tr ' ' '\n' > "$backup/files.txt"
while IFS= read -r file; do
  test -n "$file" || continue
  test -f "$root/$file"
  test -f "$stage/$file"
  mkdir -p "$backup/original/$(dirname "$file")"
  cp "$root/$file" "$backup/original/$file"
  install -D -o root -g root -m 0644 "$stage/$file" "$root/$file"
done < "$backup/files.txt"

cd "$root"
node --check src/server.js
node --check public/app.js
node --test tests
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$stage"
printf 'subagent budgets active; rollback: %s\n' "$backup"