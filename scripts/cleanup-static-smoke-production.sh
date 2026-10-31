#!/bin/sh
set -eu

application=raa-static-smoke
available=/etc/apache2/sites-available/raa-deploy-$application.conf
enabled=/etc/apache2/sites-enabled/raa-deploy-$application.conf
rm -f "$enabled"
if ! apache2ctl configtest; then
  test ! -f "$available" || ln -s "$available" "$enabled"
  exit 1
fi
systemctl reload apache2
rm -f "$available"
rm -rf "/var/lib/raa-deploy/apps/$application"
rm -rf /opt/remote-ai-access/sandbox/workspaces/debugging-media/activation-smoke-v1
rm -rf /opt/remote-ai-access/sandbox/workspaces/debugging-media/activation-smoke-v2
node - <<'NODE'
const fs = require("fs");
const file = "/var/lib/raa-deploy/registry.json";
const registry = JSON.parse(fs.readFileSync(file, "utf8"));
delete registry.applications["raa-static-smoke"];
const temporary = `${file}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(temporary, file);
NODE

test ! -e "$enabled"
test ! -e "$available"
test ! -e "/var/lib/raa-deploy/apps/$application"
echo "static smoke deployment removed"