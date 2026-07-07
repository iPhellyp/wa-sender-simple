#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/wa-sender-simple}"
cd "$PROJECT_DIR"

echo "== Project directory =="
pwd

echo "== Last commit =="
git log -1 --oneline --decorate

ENV_FILE=""
if [ -f ./.env ]; then
  ENV_FILE="./.env"
elif [ -f ./.env.production.docker ]; then
  ENV_FILE="./.env.production.docker"
fi

if [ -n "$ENV_FILE" ]; then
  echo "== Loading env from $ENV_FILE =="
  set -a
  . "$ENV_FILE"
  set +a
else
  echo "WARNING: no .env or .env.production.docker found; using current shell environment"
fi

require_env() {
  local name="$1"

  if [ -z "${!name:-}" ]; then
    echo "ERROR: $name is empty after loading env" >&2
    exit 1
  fi

  echo "OK: $name is present"
}

echo "== Validating required env =="
require_env ADMIN_PASSWORD
require_env DATABASE_URL
require_env REDIS_URL
require_env POSTGRES_DB
require_env POSTGRES_USER
require_env POSTGRES_PASSWORD
require_env APP_URL
require_env NEXT_PUBLIC_APP_URL

echo "== Disk before =="
df -h

echo "== Docker usage before =="
docker system df

echo "== Build local image =="
docker build -t wa-sender-simple:latest .

echo "== Confirm local image =="
docker images | grep wa-sender-simple

echo "== Deploy stack =="
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple

echo "== Force app service =="
docker service update --image wa-sender-simple:latest --force --detach=false wa_sender_simple_app

echo "== Force worker service =="
docker service update --image wa-sender-simple:latest --force --detach=false wa_sender_simple_worker

echo "== Stack services =="
docker stack services wa_sender_simple

echo "== App tasks =="
docker service ps wa_sender_simple_app --no-trunc

echo "== Worker tasks =="
docker service ps wa_sender_simple_worker --no-trunc

echo "== Safe cleanup =="
docker container prune -f
docker builder prune -af
docker image prune -f

echo "== Disk after =="
df -h

echo "== Docker usage after =="
docker system df
