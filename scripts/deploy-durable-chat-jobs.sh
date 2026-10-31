#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-durable-chat-jobs
backup="$root/.deploy-backup-durable-chat-jobs-v1"
failed=1
files='src/server.js src/chat-job-queue.js src/chat-job-persistence.js public/app.js public/index.html tests/chat-job-queue.test.mjs tests/chat-job-persistence.test.mjs scripts/production-chat-job-client.mjs .env.example README.md PRODUCT_ROADMAP.md'

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
node --check public/app.js
node --test tests/chat-job-queue.test.mjs tests/chat-job-persistence.test.mjs tests/chat-job-recovery.test.mjs tests/chat-jobs.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'durable chat jobs active; rollback: %s\n' "$backup"