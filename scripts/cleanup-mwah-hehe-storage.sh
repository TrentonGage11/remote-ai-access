#!/bin/sh
set -eu

workspace=/opt/remote-ai-access/sandbox/workspaces/mwah_hehe
old_git=/opt/remote-ai-access/sandbox/.mwah_hehe-git-history-cleanup
remote=/opt/remote-ai-access/sandbox/workspace-remotes/mwah_hehe.git
failed=1

media_manifest() {
  find "$workspace/nsfw" -type f -printf '%P\t%s\n' | sort | sha256sum | cut -d' ' -f1
}

restore() {
  test "$failed" -eq 1 || return 0
  if test -d "$old_git"; then
    rm -rf "$workspace/.git"
    mv "$old_git" "$workspace/.git"
  fi
  systemctl start remote-ai-access || true
}
trap restore EXIT

test -d "$workspace/.git"
test -d "$workspace/nsfw"
test ! -e "$old_git"
before_manifest=$(media_manifest)
before_count=$(find "$workspace/nsfw" -type f | wc -l)
before_bytes=$(du -sB1 "$workspace/nsfw" | cut -f1)

systemctl stop remote-ai-access
mv "$workspace/.git" "$old_git"
runuser -u remote-ai-access -- git -C "$workspace" init -b main
runuser -u remote-ai-access -- git -C "$workspace" config user.name "Remote AI Access"
runuser -u remote-ai-access -- git -C "$workspace" config user.email "remote-ai-access@localhost"
runuser -u remote-ai-access -- git -C "$workspace" remote add origin "$remote"
cat > "$workspace/.git/info/exclude" <<'EOF'
nsfw/
.audit-log.jsonl
.cache/
.upload-sessions/
**/__pycache__/
EOF
chown remote-ai-access:remote-ai-access "$workspace/.git/info/exclude"
runuser -u remote-ai-access -- git -C "$workspace" add -A
runuser -u remote-ai-access -- git -C "$workspace" commit --allow-empty -m "Reset snapshots after media storage cleanup"

after_manifest=$(media_manifest)
after_count=$(find "$workspace/nsfw" -type f | wc -l)
after_bytes=$(du -sB1 "$workspace/nsfw" | cut -f1)
test "$before_manifest" = "$after_manifest"
test "$before_count" = "$after_count"
test "$before_bytes" = "$after_bytes"
runuser -u remote-ai-access -- git -C "$workspace" check-ignore -q nsfw

failed=0
trap - EXIT
rm -rf "$old_git"
systemctl start remote-ai-access
systemctl is-active --quiet remote-ai-access
printf 'media-preserved count=%s bytes=%s manifest=%s\n' "$after_count" "$after_bytes" "$after_manifest"