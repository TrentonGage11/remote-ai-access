#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-google-agent-quota-guard
backup="$root/.deploy-backup-google-agent-quota-guard-v2"
files='src/server.js src/compatible-agent-context.js tests/compatible-agent-context.test.mjs .env.example'
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  while IFS= read -r file; do
    test -n "$file" || continue
    if test -f "$backup/$file"; then
      install -D -o root -g root -m 0644 "$backup/$file" "$root/$file"
    else
      rm -f "$root/$file"
    fi
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
  test -f "$staging/$file"
  if test -f "$root/$file"; then
    mkdir -p "$backup/$(dirname "$file")"
    cp "$root/$file" "$backup/$file"
  fi
  install -D -o root -g root -m 0644 "$staging/$file" "$root/$file"
done < "$backup/files.txt"

cd "$root"
node --check src/server.js
node --check src/compatible-agent-context.js
node --test tests/compatible-agent-context.test.mjs tests/chat-context.test.mjs tests/provider-retry.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'google agent quota guard active; rollback: %s\n' "$backup"