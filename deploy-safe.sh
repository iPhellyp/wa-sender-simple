#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="${PROJECT_DIR:-/root/wa-sender-simple}"
cd "$PROJECT_DIR"

env_file=""
if [[ -f ./.env ]]; then
  env_file="./.env"
elif [[ -f ./.env.production.docker ]]; then
  env_file="./.env.production.docker"
else
  echo "Arquivo de ambiente de producao ausente" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || {
    echo "Variavel obrigatoria ausente: $name" >&2
    exit 1
  }
  echo "OK: $name presente"
}

wait_for_healthy_service() {
  local service="$1"
  local deadline=$((SECONDS + 300))
  local -a ids
  local health
  while (( SECONDS < deadline )); do
    mapfile -t ids < <(
      docker ps --filter "label=com.docker.swarm.service.name=${service}" \
        --format '{{.ID}}'
    )
    if [[ "${#ids[@]}" -eq 1 ]]; then
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${ids[0]}")"
      [[ "$health" == "healthy" ]] && return 0
    fi
    sleep 5
  done
  echo "Timeout aguardando healthcheck de ${service}" >&2
  return 1
}

for name in \
  ADMIN_PASSWORD DATABASE_URL REDIS_URL POSTGRES_DB POSTGRES_USER \
  POSTGRES_PASSWORD APP_URL NEXT_PUBLIC_APP_URL WA2_INTERNAL_API_SECRET \
  WA2_INTERNAL_API_RATE_LIMIT WA2_INTERNAL_API_RATE_WINDOW_SECONDS \
  WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS
do
  require_env "$name"
done

[[ "$APP_URL" == https://* && "$NEXT_PUBLIC_APP_URL" == https://* ]] || {
  echo "URLs de producao devem usar HTTPS" >&2
  exit 1
}

git diff --quiet
git diff --cached --quiet
[[ -z "$(git status --porcelain)" ]] || { echo "Git deve estar limpo" >&2; exit 1; }

branch="$(git branch --show-current)"
commit="$(git rev-parse HEAD)"
short_sha="$(git rev-parse --short=12 HEAD)"
if [[ "${IMAGE_TAG+x}" == "x" ]]; then
  [[ -n "$IMAGE_TAG" ]] || { echo "IMAGE_TAG nao pode ser vazia" >&2; exit 1; }
else
  IMAGE_TAG="$short_sha"
fi
[[ "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || {
  echo "IMAGE_TAG invalida ou vazia" >&2
  exit 1
}
export IMAGE_TAG
echo "Git confirmado: branch=${branch} commit=${commit}"
echo "Tag imutavel selecionada: ${IMAGE_TAG}"

docker service scale wa_sender_simple_worker=0
bash ./scripts/backup.sh
docker build -t "wa-sender-simple:${IMAGE_TAG}" .
echo "Imagem publicada localmente: wa-sender-simple:${IMAGE_TAG}"

export APP_REPLICAS=0
export WORKER_REPLICAS=0
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple

migration_env="$(mktemp)"
chmod 600 "$migration_env"
trap 'rm -f "$migration_env"' EXIT
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$migration_env"
docker run --rm \
  --network wa_sender_simple_wa_sender_internal \
  --env-file "$migration_env" \
  "wa-sender-simple:${IMAGE_TAG}" npm run prisma:deploy

export APP_REPLICAS=1
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple
wait_for_healthy_service wa_sender_simple_app

export WORKER_REPLICAS=1
docker stack deploy --resolve-image never -c docker-stack.yml wa_sender_simple
wait_for_healthy_service wa_sender_simple_worker

echo "Deploy concluido com tag: ${IMAGE_TAG}"
echo "Inspecao: docker stack services wa_sender_simple"
echo "Inspecao: docker service ps wa_sender_simple_app --no-trunc"
echo "Inspecao: docker service ps wa_sender_simple_worker --no-trunc"
echo "Nenhuma importacao de leads foi executada."
