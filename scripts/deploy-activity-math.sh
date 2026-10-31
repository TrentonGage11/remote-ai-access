#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-activity-math
backup="$root/.deploy-backup-activity-math-v1"
failed=1
files='src/server.js src/workspace-activity.js public/activity.html public/activity.js public/app.js public/api-tools.js public/index.html public/styles.css tests/workspace-activity.test.mjs package.json package-lock.json .env.example README.md PRODUCT_ROADMAP.md scripts/verify-image-generation-production.sh scripts/check-xai-image-api.mjs scripts/verify-activity-math-local.mjs'

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
  if test -f "$backup/original/.env"; then
    install -o root -g root -m 0600 "$backup/original/.env" "$root/.env"
  fi
  cd "$root"
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true
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

cp "$root/.env" "$backup/original/.env"
chmod 0600 "$backup/original/.env"
if grep -qx 'XAI_IMAGE_MODEL=grok-2-image-1212' "$root/.env"; then
  sed 's/^XAI_IMAGE_MODEL=grok-2-image-1212$/XAI_IMAGE_MODEL=grok-imagine-image/' "$root/.env" > "$root/.env.activity-math.tmp"
  install -o root -g root -m 0600 "$root/.env.activity-math.tmp" "$root/.env"
  rm -f "$root/.env.activity-math.tmp"
fi

cd "$root"
npm install --omit=dev --no-audit --no-fund
node --check src/server.js
node --check public/app.js
node --check public/activity.js
node --test tests
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'activity timeline and math UI active; rollback: %s\n' "$backup"