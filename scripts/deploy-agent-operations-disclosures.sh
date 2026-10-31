#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-agent-operations-disclosures
backup="$root/.deploy-backup-agent-operations-disclosures-v1"
failed=1
files='public/index.html public/styles.css'

restore() {
  test "$failed" -eq 1 || return 0
  while IFS= read -r file; do
    test -n "$file" || continue
    install -D -o root -g root -m 0644 "$backup/original/$file" "$root/$file"
  done < "$backup/files.txt"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup/original"
printf '%s\n' "$files" | tr ' ' '\n' > "$backup/files.txt"
while IFS= read -r file; do
  test -n "$file" || continue
  test -f "$root/$file"
  test -f "$staging/$file"
  mkdir -p "$backup/original/$(dirname "$file")"
  cp "$root/$file" "$backup/original/$file"
  install -D -o root -g root -m 0644 "$staging/$file" "$root/$file"
done < "$backup/files.txt"

cd "$root"
node --test tests
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'agent operations disclosures active; rollback: %s\n' "$backup"