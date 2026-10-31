#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-operations-batch
backup="$root/.deploy-backup-operations-batch-v1"
failed=1

files='src/server.js src/basic-auth-session.js src/share-analytics.js src/git-change-center.js src/runtime-monitor.js src/usage-ledger.js public/index.html public/filelab.html public/filelab.js public/styles.css public/git-change-center.html public/git-change-center.js public/operations.html public/operations.js public/usage.html public/usage.js tests/basic-auth-session.test.mjs tests/share-analytics.test.mjs tests/git-change-center.test.mjs tests/runtime-monitor.test.mjs tests/usage-ledger.test.mjs .env.example README.md PRODUCT_ROADMAP.md'

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
  cp "$backup/env" "$root/.env"
  chown root:root "$root/.env"
  chmod 0600 "$root/.env"
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup/original"
printf '%s\n' "$files" | tr ' ' '\n' > "$backup/files.txt"
cp "$root/.env" "$backup/env"

while IFS= read -r file; do
  test -n "$file" || continue
  if test -f "$root/$file"; then
    mkdir -p "$backup/original/$(dirname "$file")"
    cp "$root/$file" "$backup/original/$file"
  fi
  test -f "$staging/$file"
  install -D -o root -g root -m 0644 "$staging/$file" "$root/$file"
done < "$backup/files.txt"

if ! grep -q '^BASIC_AUTH_SESSION_SECRET=' "$root/.env"; then
  printf '\nBASIC_AUTH_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> "$root/.env"
fi
chown root:root "$root/.env"
chmod 0600 "$root/.env"

cd "$root"
node --check src/server.js
node --check public/git-change-center.js
node --check public/operations.js
node --check public/usage.js
node --test tests/*.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'operations batch active; rollback: %s\n' "$backup"