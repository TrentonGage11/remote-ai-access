#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-agent-expansion
backup="$root/.deploy-backup-agent-expansion-v1"
failed=1
files='src/server.js src/agent-policy.js src/subagent-policy.js src/workspace-unlock-codes.js src/image-tools.js public/index.html public/security-admin.html public/security-admin.js tests/agent-policy.test.mjs tests/subagent-policy.test.mjs tests/workspace-unlock-codes.test.mjs tests/image-tools.test.mjs .env.example README.md PRODUCT_ROADMAP.md SUBAGENTS.md'

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
  install -D -o root -g root -m 0644 "$staging/$file" "$root/$file"
done < "$backup/files.txt"

cd "$root"
node --check src/server.js
node --check public/security-admin.js
node --test tests/agent-policy.test.mjs tests/subagent-policy.test.mjs tests/workspace-unlock-codes.test.mjs tests/image-tools.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'agent expansion active; rollback: %s\n' "$backup"