#!/bin/sh
set -eu

for id in 089e9a0c03a4 27251747003d 74ac5bdd3f40 af7bdec92b52; do
  full=$(docker inspect --format '{{.Id}}' "$id")
  printf '%s\n' "=== $id ==="
  docker inspect --format 'name={{.Name}} image={{.Config.Image}} log={{.LogPath}} started={{.State.StartedAt}} command={{json .Config.Cmd}} labels={{json .Config.Labels}}' "$id"
  find "/var/lib/docker/containers/$full" -maxdepth 2 -type f -printf '%s %p\n' | sort -n | tail -8
done
