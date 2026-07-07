#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$PROJECT_DIR"

if [ -f ./.env ]; then
  set -a
  . ./.env
  set +a
fi

echo "== Disk before =="
df -h

echo "== Docker usage before =="
docker system df

echo "== Build single image =="
docker compose build app

echo "== Deploy stack =="
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple

echo "== Safe cleanup =="
docker container prune -f
docker builder prune -af
docker image prune -af

echo "== Disk after =="
df -h

echo "== Docker usage after =="
docker system df

echo "== Stack services =="
docker stack services wa_sender_simple
