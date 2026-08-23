# Server Connection Runbook (WSL)

This note is for future agents/operators working from this repository on Windows.

## Confirmed target

- SSH host: `root@198.74.54.235`
- Live app repo path on server: `/opt/remote-ai-access`
- Systemd service: `remote-ai-access`

## Path caveats

- `/opt/remote-ai-access` exists and is the active deployment path.
- `/opt-remote-ai-access` was checked and does **not** exist on this host.
- `/var/www/remote-ai-access` was checked and does **not** exist on this host.

## Run from Windows via WSL

Use this pattern from PowerShell in the repo root:

```powershell
wsl -e sh -lc 'ssh -o BatchMode=yes root@198.74.54.235 "echo ok"'
```

If you need verbose SSH diagnostics:

```powershell
wsl -e sh -lc 'ssh -v -o BatchMode=yes root@198.74.54.235 exit'
```

## Deploy changed files quickly

```powershell
wsl -e sh -lc 'set -e; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/src/server.js root@198.74.54.235:/opt/remote-ai-access/src/server.js; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/public/app.js root@198.74.54.235:/opt/remote-ai-access/public/app.js; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/public/index.html root@198.74.54.235:/opt/remote-ai-access/public/index.html; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/public/archive.html root@198.74.54.235:/opt/remote-ai-access/public/archive.html; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/public/archive.js root@198.74.54.235:/opt/remote-ai-access/public/archive.js; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/public/history.html root@198.74.54.235:/opt/remote-ai-access/public/history.html; \
scp -o BatchMode=yes /mnt/u/Projects/remote-ai-access/public/history.js root@198.74.54.235:/opt/remote-ai-access/public/history.js; \
ssh -o BatchMode=yes root@198.74.54.235 "systemctl restart remote-ai-access && systemctl is-active remote-ai-access"'
```

## Useful server checks

Service health:

```powershell
wsl -e sh -lc 'ssh -o BatchMode=yes root@198.74.54.235 "systemctl status remote-ai-access --no-pager -n 80"'
```

Recent logs:

```powershell
wsl -e sh -lc 'ssh -o BatchMode=yes root@198.74.54.235 "journalctl -u remote-ai-access -n 120 --no-pager"'
```

Runtime config snapshot:

```powershell
wsl -e sh -lc 'ssh -o BatchMode=yes root@198.74.54.235 "curl -sS http://127.0.0.1:8787/api/config"'
```

## Notes

- Avoid nested quote-heavy one-liners when possible; prefer simple remote commands or temporary script files.
- If PowerShell quoting starts mangling shell regex/awk snippets, move logic into a `.sh` file and run it via `wsl -e sh /mnt/u/...`.
