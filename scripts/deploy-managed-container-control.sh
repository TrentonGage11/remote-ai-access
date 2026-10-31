#!/bin/sh
set -eu

root=/opt/remote-ai-access
stage=/tmp/raa-managed-container-control
backup="$root/.deploy-backup-managed-container-control-v1"
failed=1
files='src/server.js src/managed-tool-containers.js tests/managed-tool-containers.test.mjs public/app.js public/index.html public/styles.css'

restore() {
  test "$failed" -eq 1 || return 0
  while IFS= read -r file; do
    test -n "$file" || continue
    if test -f "$backup/original/$file.absent"; then
      rm -f "$root/$file"
    else
      cp "$backup/original/$file" "$root/$file"
    fi
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
  test -f "$stage/$file"
  mkdir -p "$backup/original/$(dirname "$file")"
  if test -f "$root/$file"; then cp "$root/$file" "$backup/original/$file"; else : > "$backup/original/$file.absent"; fi
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
printf 'managed container control active; rollback: %s\n' "$backup"