#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-subagent-acceptance
backup="$root/.deploy-backup-subagent-acceptance-v1"
failed=1
files='src/server.js src/subagent-results.js public/app.js public/index.html public/styles.css tests/subagent-results.test.mjs scripts/verify-image-generation-production.sh README.md PRODUCT_ROADMAP.md SUBAGENTS.md'

restore() {
  test "$failed" -eq 1 || return 0
  while IFS= read -r file; do
    test -n "$file" || continue
    if test -f "$backup/original/$file"; then
      install -D -o root -g root -m 0644 "$backup/original/$file" "$root/$file"
    else
      rm -f "$root/$file"
    fi
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
  if test -f "$root/$file"; then
    mkdir -p "$backup/original/$(dirname "$file")"
    cp "$root/$file" "$backup/original/$file"
  fi
  test -f "$staging/$file"
  mode=0644
  case "$file" in scripts/*.sh) mode=0750 ;; esac
  install -D -o root -g root -m "$mode" "$staging/$file" "$root/$file"
done < "$backup/files.txt"

cd "$root"
node --check src/server.js
node --check public/app.js
node --test tests
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'subagent acceptance active; rollback: %s\n' "$backup"