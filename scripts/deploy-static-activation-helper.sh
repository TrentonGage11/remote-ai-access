#!/bin/sh
set -eu

root=/opt/remote-ai-access
staging=/tmp/raa-static-activation-helper
backup="$root/.deploy-backup-static-activation-helper-v1"
failed=1

restore() {
  test "$failed" -eq 1 || return 0
  systemctl disable --now raa-deploy-helper.socket >/dev/null 2>&1 || true
  for file in server.js deployment-approval.js deployment-helper.js deployment-helper-policy.js; do
    if test -f "$backup/$file"; then cp "$backup/$file" "$root/src/$file"; else rm -f "$root/src/$file"; fi
  done
  if test -f "$backup/raa-deploy-helper.socket"; then cp "$backup/raa-deploy-helper.socket" /etc/systemd/system/raa-deploy-helper.socket; else rm -f /etc/systemd/system/raa-deploy-helper.socket; fi
  if test -f "$backup/raa-deploy-helper.service"; then cp "$backup/raa-deploy-helper.service" /etc/systemd/system/raa-deploy-helper.service; else rm -f /etc/systemd/system/raa-deploy-helper.service; fi
  cp "$backup/.env" "$root/.env"
  systemctl daemon-reload
  systemctl restart remote-ai-access || true
}
trap restore EXIT

test -d "$staging"
test ! -e "$backup"
mkdir -p "$backup"
cp "$root/.env" "$backup/.env"
for file in server.js deployment-approval.js deployment-helper.js deployment-helper-policy.js; do
  test ! -f "$root/src/$file" || cp "$root/src/$file" "$backup/$file"
done
test ! -f /etc/systemd/system/raa-deploy-helper.socket || cp /etc/systemd/system/raa-deploy-helper.socket "$backup/raa-deploy-helper.socket"
test ! -f /etc/systemd/system/raa-deploy-helper.service || cp /etc/systemd/system/raa-deploy-helper.service "$backup/raa-deploy-helper.service"

install -o root -g root -m 0644 "$staging/server.js" "$root/src/server.js"
install -o root -g root -m 0644 "$staging/deployment-approval.js" "$root/src/deployment-approval.js"
install -o root -g root -m 0644 "$staging/deployment-helper.js" "$root/src/deployment-helper.js"
install -o root -g root -m 0644 "$staging/deployment-helper-policy.js" "$root/src/deployment-helper-policy.js"
install -o root -g root -m 0644 "$staging/deployment-approval.test.mjs" "$root/tests/deployment-approval.test.mjs"
install -o root -g root -m 0644 "$staging/deployment-helper-policy.test.mjs" "$root/tests/deployment-helper-policy.test.mjs"
install -o root -g root -m 0644 "$staging/raa-deploy-helper.socket" /etc/systemd/system/raa-deploy-helper.socket
install -o root -g root -m 0644 "$staging/raa-deploy-helper.service" /etc/systemd/system/raa-deploy-helper.service
install -d -o root -g root -m 0755 /var/lib/raa-deploy
find "$root/sandbox/workspaces" -mindepth 1 -maxdepth 1 -type d -exec chmod 0750 {} \;

if grep -q '^DEPLOYMENT_HELPER_SOCKET_PATH=' "$root/.env"; then
  sed -i 's|^DEPLOYMENT_HELPER_SOCKET_PATH=.*|DEPLOYMENT_HELPER_SOCKET_PATH=/run/raa-deploy/helper.sock|' "$root/.env"
else
  printf '\nDEPLOYMENT_HELPER_SOCKET_PATH=/run/raa-deploy/helper.sock\n' >> "$root/.env"
fi
if grep -q '^DEPLOYMENT_HELPER_TIMEOUT_MS=' "$root/.env"; then
  sed -i 's|^DEPLOYMENT_HELPER_TIMEOUT_MS=.*|DEPLOYMENT_HELPER_TIMEOUT_MS=30000|' "$root/.env"
else
  printf 'DEPLOYMENT_HELPER_TIMEOUT_MS=30000\n' >> "$root/.env"
fi

cd "$root"
node --check src/server.js
node --check src/deployment-helper.js
node --test tests/deployment-approval.test.mjs tests/deployment-helper-policy.test.mjs tests/deployment-policy.test.mjs tests/agent-policy.test.mjs
systemctl daemon-reload
systemctl enable --now raa-deploy-helper.socket
systemctl restart remote-ai-access
systemctl is-active --quiet remote-ai-access
systemctl is-active --quiet raa-deploy-helper.socket
test "$(stat -c '%U:%G:%a' /run/raa-deploy/helper.sock)" = 'root:remote-ai-access:660'

failed=0
trap - EXIT
rm -rf "$staging"
printf 'static activation helper active; rollback: %s\n' "$backup"