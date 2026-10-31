#!/usr/bin/env bash
set -Eeuo pipefail

# Run from WSL in the repository checkout. This intentionally deploys a staged
# Git release rather than turning the stateful production directory into a
# working tree: /opt/remote-ai-access contains runtime state and is not a clone.

remote_host="${RAA_DEPLOY_SSH_HOST:-tg11}"
remote_root="${RAA_DEPLOY_ROOT:-/opt/remote-ai-access}"
service_name="${RAA_DEPLOY_SERVICE:-remote-ai-access}"
marker_path="${remote_root}/.deployed-git-sha"
skip_push="false"

if [[ "${1:-}" == "--no-push" ]]; then
  skip_push="true"
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
node_bin="$(command -v node || command -v node.exe || true)"
if [[ -z "$node_bin" ]]; then
  echo "Node.js is required to run the deployment tests." >&2
  exit 1
fi

# The checkout is shared with Windows, whose Git uses CRLF normalization. Keep
# the safety check from treating WSL's LF view as a mass of real edits.
if [[ -n "$(git -c core.autocrlf=true status --porcelain)" ]]; then
  echo "Refusing deployment: working tree is not clean." >&2
  exit 1
fi

if [[ "${RAA_DEPLOY_SKIP_TESTS:-false}" != "true" ]]; then
  "$node_bin" --test tests/*.test.mjs
fi

if [[ "$skip_push" != "true" ]]; then
  git push origin HEAD
fi

release_sha="$(git rev-parse HEAD)"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/raa-release.XXXXXX")"
remote_stage="/tmp/raa-release-${release_sha}"
cleanup() {
  rm -rf "$stage_dir"
  ssh "$remote_host" "rm -rf '$remote_stage'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

previous_sha="$(ssh "$remote_host" "cat '$marker_path' 2>/dev/null || true")"
paths=()
has_previous_release="false"
if [[ "$previous_sha" =~ ^[0-9a-f]{40}$ ]] && git cat-file -e "${previous_sha}^{commit}" 2>/dev/null; then
  has_previous_release="true"
  while IFS= read -r item; do
    paths+=("$item")
  done < <(git diff --name-only "$previous_sha" "$release_sha" -- src public package.json package-lock.json)
fi

# A missing marker or an empty diff means this is the first release from this
# checkout. Include the runtime tree, but never touch sandbox state or .env.
if [[ "${#paths[@]}" -eq 0 && "$has_previous_release" == "true" ]]; then
  ssh "$remote_host" "systemctl restart '$service_name' && systemctl is-active --quiet '$service_name' && printf '%s\\n' '$release_sha' > '$marker_path'"
  echo "No runtime files changed; production service restarted at $release_sha"
  exit 0
fi

if [[ "${#paths[@]}" -eq 0 ]]; then
  paths=(src public package.json package-lock.json)
fi

git archive --format=tar "$release_sha" -- "${paths[@]}" | tar -xf - -C "$stage_dir"

ssh "$remote_host" "mkdir -p '$remote_stage'"
tar -C "$stage_dir" -czf - . | ssh "$remote_host" "tar -xzf - -C '$remote_stage'"

ssh "$remote_host" "bash -s" <<EOF
set -Eeuo pipefail
root=$(printf '%q' "$remote_root")
stage=$(printf '%q' "$remote_stage")
backup="\$root/.deploy-backup-${release_sha}"
mkdir -p "\$backup"
while IFS= read -r -d '' file; do
  rel="\${file#\$stage/}"
  if [[ -e "\$root/\$rel" ]]; then
    mkdir -p "\$backup/\$(dirname "\$rel")"
    cp -a "\$root/\$rel" "\$backup/\$rel"
  fi
done < <(find "\$stage" -type f -print0)
cp -a "\$stage/." "\$root/"
if [[ -f "\$stage/package-lock.json" ]]; then
  cd "\$root"
  npm ci --omit=dev --ignore-scripts
fi
cd "\$root"
node --check src/server.js
systemctl restart $(printf '%q' "$service_name")
systemctl is-active --quiet $(printf '%q' "$service_name")
printf '%s\\n' $(printf '%q' "$release_sha") > "\$root/.deployed-git-sha"
echo "deployed $(printf '%q' "$release_sha")"
echo "backup \$(printf '%q' "\$backup")"
EOF

echo "Production deployment complete: $release_sha"
