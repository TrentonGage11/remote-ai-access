#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-deployment-foundation
backup="$root/.deploy-backup-deployment-foundation-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  cp "$backup/server.js" "$root/src/server.js"
  cp "$backup/agent-policy.js" "$root/src/agent-policy.js"
  cp "$backup/.env" "$root/.env"
  if test -f "$backup/deployment-policy.js"; then
    cp "$backup/deployment-policy.js" "$root/src/deployment-policy.js"
  else
    rm -f "$root/src/deployment-policy.js"
  fi
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/src/server.js" "$backup/server.js"
cp "$root/src/agent-policy.js" "$backup/agent-policy.js"
cp "$root/.env" "$backup/.env"
test ! -f "$root/src/deployment-policy.js" || cp "$root/src/deployment-policy.js" "$backup/deployment-policy.js"

install -m 0644 "$staging/server.js" "$root/src/server.js"
install -m 0644 "$staging/agent-policy.js" "$root/src/agent-policy.js"
install -m 0644 "$staging/deployment-policy.js" "$root/src/deployment-policy.js"
install -m 0644 "$staging/agent-policy.test.mjs" "$root/tests/agent-policy.test.mjs"
install -m 0644 "$staging/deployment-policy.test.mjs" "$root/tests/deployment-policy.test.mjs"
install -m 0644 "$staging/.env.example" "$root/.env.example"
install -m 0644 "$staging/AGENT_DEPLOYMENT_PROFILE.md" "$root/AGENT_DEPLOYMENT_PROFILE.md"
install -m 0644 "$staging/PRODUCT_ROADMAP.md" "$root/PRODUCT_ROADMAP.md"

set_config() {
  name=$1
  value=$2
  if grep -q "^${name}=" "$root/.env"; then
    sed -i "s|^${name}=.*|${name}=${value}|" "$root/.env"
  else
    printf '\n%s=%s\n' "$name" "$value" >> "$root/.env"
  fi
}

set_config DEPLOYMENT_ALLOWED_SUFFIXES tg11.org
set_config DEPLOYMENT_ALLOWED_RUNTIMES static,node-service
set_config DEPLOYMENT_ALLOWED_ENV_NAMES ''
set_config DEPLOYMENT_PREVIEW_PORT 8900

cd "$root"
node --check src/server.js
node --test tests/agent-policy.test.mjs tests/deployment-policy.test.mjs tests/subagent-policy.test.mjs
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access

failed=0
trap - EXIT
rm -rf "$staging"
printf 'deployment foundation active; rollback: %s\n' "$backup"