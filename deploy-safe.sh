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

stack_name="wa_sender_simple"
BACKUP_ROOT="${BACKUP_ROOT:-/root/wa-sender-simple-backups}"
MIGRATION_NETWORK="${MIGRATION_NETWORK:-${stack_name}_wa_sender_internal}"
MIGRATION_TIMEOUT_SECONDS="${MIGRATION_TIMEOUT_SECONDS:-300}"
MIGRATION_SERVICE_NAME_MAX_LENGTH=63
PREFLIGHT_TIMEOUT_SECONDS="${PREFLIGHT_TIMEOUT_SECONDS:-120}"
PREFLIGHT_SERVICE_NAME_MAX_LENGTH=63
migration_service=""
migration_env=""
preflight_service=""
preflight_env=""
previous_app_image=""
previous_worker_image=""
previous_app_replicas=""
previous_worker_replicas=""
previous_app_container_image_id=""
previous_worker_container_image_id=""

sanitize_migration_output() {
  local -a sensitive_values=(
    "${DATABASE_URL:-}" "${POSTGRES_PASSWORD:-}" "${ADMIN_PASSWORD:-}"
    "${REDIS_URL:-}" "${WA2_INTERNAL_API_SECRET:-}" "${WA2_INTERNAL_API_PREVIOUS_SECRET:-}"
  )
  local line
  local value
  while IFS= read -r line || [[ -n "$line" ]]; do
    for value in "${sensitive_values[@]}"; do
      [[ -n "$value" ]] && line="${line//"$value"/[REDACTED]}"
    done
    printf '%s\n' "$line"
  done | sed -E \
    -e 's#(postgres(ql)?://[^:/[:space:]]+):[^@[:space:]]+@#\1:[REDACTED]@#gI' \
    -e "s/((secret|password|token|api[_-]?key)[\"']?[[:space:]]*[:=][[:space:]]*[\"']?)[^,\"' }[:space:]]+/\1[REDACTED]/gI" \
    -e 's/[A-Za-z0-9+\/_=.-]{48,}/[REDACTED_LONG]/g'
}

cleanup_migration_service() {
  local cleanup_failed=0
  if [[ -n "$migration_service" ]] &&
     docker service inspect "$migration_service" > /dev/null 2>&1; then
    if ! docker service rm "$migration_service" > /dev/null 2>&1; then
      echo "Falha ao remover servico temporario de migration" >&2
      cleanup_failed=1
    fi
  fi
  if [[ -n "$migration_env" ]]; then
    if ! rm -f -- "$migration_env"; then
      echo "Falha ao remover arquivo temporario da migration" >&2
      cleanup_failed=1
    fi
  fi
  return "$cleanup_failed"
}

cleanup_preflight_service() {
  local cleanup_failed=0
  if [[ -n "$preflight_service" ]] &&
     docker service inspect "$preflight_service" > /dev/null 2>&1; then
    if ! docker service rm "$preflight_service" > /dev/null 2>&1; then
      echo "Falha ao remover servico temporario de preflight" >&2
      cleanup_failed=1
    fi
  fi
  if [[ -n "$preflight_env" ]]; then
    if ! rm -f -- "$preflight_env"; then
      echo "Falha ao remover arquivo temporario do preflight" >&2
      cleanup_failed=1
    fi
  fi
  return "$cleanup_failed"
}

cleanup_migration_on_exit() {
  local status=$?
  trap - EXIT
  cleanup_preflight_service || true
  cleanup_migration_service || true
  exit "$status"
}

show_migration_diagnostics() {
  echo "Diagnostico sanitizado da migration:" >&2
  docker service ps "$migration_service" --no-trunc \
    --format 'STATE={{.CurrentState}} ERROR={{.Error}}' 2>&1 |
    sanitize_migration_output >&2 || true
  docker service logs "$migration_service" --tail 100 2>&1 |
    sanitize_migration_output >&2 || true
}

wait_for_migration_service() {
  local deadline=$((SECONDS + MIGRATION_TIMEOUT_SECONDS))
  local task_id=""
  local state=""
  local exit_code="-1"

  while (( SECONDS < deadline )); do
    task_id="$(
      docker service ps "$migration_service" --no-trunc \
        --format '{{.ID}}' 2>/dev/null | head -n 1
    )"
    if [[ -n "$task_id" ]]; then
      state="$(docker inspect --type task --format '{{.Status.State}}' "$task_id" 2>/dev/null || true)"
      if [[ "$state" =~ ^(complete|failed|rejected|shutdown|orphaned|remove)$ ]]; then
        exit_code="$(
          docker inspect --type task \
            --format '{{if .Status.ContainerStatus}}{{.Status.ContainerStatus.ExitCode}}{{else}}-1{{end}}' \
            "$task_id" 2>/dev/null || printf '%s' '-1'
        )"
        if [[ "$state" == "complete" && "$exit_code" == "0" ]]; then
          echo "Migration concluida: task=${task_id} state=${state} exitCode=${exit_code}"
          return 0
        fi
        echo "Migration falhou: state=${state} exitCode=${exit_code}" >&2
        show_migration_diagnostics
        return 1
      fi
    fi
    sleep 2
  done

  echo "Timeout de ${MIGRATION_TIMEOUT_SECONDS}s aguardando migration" >&2
  show_migration_diagnostics
  return 1
}

run_swarm_migration() {
  local image="wa-sender-simple:${IMAGE_TAG}"
  local safe_tag
  local epoch
  local create_output

  [[ "$MIGRATION_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || {
    echo "MIGRATION_NETWORK invalida" >&2
    return 1
  }
  [[ "$MIGRATION_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] &&
    (( MIGRATION_TIMEOUT_SECONDS >= 30 && MIGRATION_TIMEOUT_SECONDS <= 3600 )) || {
      echo "MIGRATION_TIMEOUT_SECONDS deve ficar entre 30 e 3600" >&2
      return 1
    }
  docker network inspect "$MIGRATION_NETWORK" > /dev/null

  safe_tag="$(printf '%s' "$IMAGE_TAG" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-12)"
  epoch="$(date +%s)"
  migration_service="w2m_${safe_tag}_${epoch}_$$"
  (( ${#migration_service} <= MIGRATION_SERVICE_NAME_MAX_LENGTH )) || {
    echo "Nome do servico temporario de migration excede 63 caracteres" >&2
    return 1
  }
  migration_env="$(mktemp)"
  chmod 600 "$migration_env"
  printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > "$migration_env"

  if ! create_output="$(
    docker service create \
      --detach \
      --name "$migration_service" \
      --replicas 1 \
      --restart-condition none \
      --constraint 'node.role==manager' \
      --network "$MIGRATION_NETWORK" \
      --env-file "$migration_env" \
      --no-resolve-image \
      "$image" npm run prisma:deploy 2>&1
  )"; then
    echo "Falha ao criar servico temporario de migration" >&2
    printf '%s\n' "$create_output" | sanitize_migration_output >&2
    return 1
  fi

  wait_for_migration_service
}

show_preflight_diagnostics() {
  echo "Diagnostico sanitizado do preflight:" >&2
  docker service ps "$preflight_service" --no-trunc \
    --format 'STATE={{.CurrentState}} ERROR={{.Error}}' 2>&1 |
    sanitize_migration_output >&2 || true
  docker service logs "$preflight_service" --tail 150 2>&1 |
    sanitize_migration_output >&2 || true
}

wait_for_preflight_service() {
  local deadline=$((SECONDS + PREFLIGHT_TIMEOUT_SECONDS))
  local task_id=""
  local state=""
  local exit_code="-1"

  while (( SECONDS < deadline )); do
    task_id="$(
      docker service ps "$preflight_service" --no-trunc \
        --format '{{.ID}}' 2>/dev/null | head -n 1
    )"
    if [[ -n "$task_id" ]]; then
      state="$(docker inspect --type task --format '{{.Status.State}}' "$task_id" 2>/dev/null || true)"
      if [[ "$state" =~ ^(complete|failed|rejected|shutdown|orphaned|remove)$ ]]; then
        exit_code="$(
          docker inspect --type task \
            --format '{{if .Status.ContainerStatus}}{{.Status.ContainerStatus.ExitCode}}{{else}}-1{{end}}' \
            "$task_id" 2>/dev/null || printf '%s' '-1'
        )"
        if [[ "$state" == "complete" && "$exit_code" == "0" ]]; then
          echo "Preflight concluido: task=${task_id} state=${state} exitCode=${exit_code}"
          return 0
        fi
        echo "Preflight falhou: state=${state} exitCode=${exit_code}" >&2
        show_preflight_diagnostics
        return 1
      fi
    fi
    sleep 2
  done

  echo "Timeout de ${PREFLIGHT_TIMEOUT_SECONDS}s aguardando preflight" >&2
  show_preflight_diagnostics
  return 1
}

run_swarm_preflight() {
  local image="wa-sender-simple:${IMAGE_TAG}"
  local safe_tag
  local epoch
  local create_output

  [[ "$MIGRATION_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || {
    echo "MIGRATION_NETWORK invalida" >&2
    return 1
  }
  [[ "$PREFLIGHT_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]] &&
    (( PREFLIGHT_TIMEOUT_SECONDS >= 30 && PREFLIGHT_TIMEOUT_SECONDS <= 600 )) || {
      echo "PREFLIGHT_TIMEOUT_SECONDS deve ficar entre 30 e 600" >&2
      return 1
    }
  docker network inspect "$MIGRATION_NETWORK" > /dev/null

  safe_tag="$(printf '%s' "$IMAGE_TAG" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-12)"
  epoch="$(date +%s)"
  preflight_service="w2p_${safe_tag}_${epoch}_$$"
  (( ${#preflight_service} <= PREFLIGHT_SERVICE_NAME_MAX_LENGTH )) || {
    echo "Nome do servico temporario de preflight excede 63 caracteres" >&2
    return 1
  }
  preflight_env="$(mktemp)"
  chmod 600 "$preflight_env"
  printf 'DATABASE_URL=%s\nREDIS_URL=%s\n' \
    "$DATABASE_URL" "$REDIS_URL" > "$preflight_env"

  if ! create_output="$(
    docker service create \
      --detach \
      --name "$preflight_service" \
      --replicas 1 \
      --restart-condition none \
      --constraint 'node.role==manager' \
      --network "$MIGRATION_NETWORK" \
      --env-file "$preflight_env" \
      --no-resolve-image \
      "$image" npm run worker:preflight 2>&1
  )"; then
    echo "Falha ao criar servico temporario de preflight" >&2
    printf '%s\n' "$create_output" | sanitize_migration_output >&2
    return 1
  fi

  wait_for_preflight_service
}

trap cleanup_migration_on_exit EXIT

show_service_health_diagnostics() {
  local service="$1"
  local -a ids

  echo "Diagnostico sanitizado do healthcheck de ${service}:" >&2
  docker service ps "$service" --no-trunc \
    --format 'TASK={{.ID}} STATE={{.CurrentState}} ERROR={{.Error}}' 2>&1 |
    sanitize_migration_output >&2 || true
  docker service logs "$service" --tail 150 2>&1 |
    sanitize_migration_output >&2 || true
  mapfile -t ids < <(
    docker ps --filter "label=com.docker.swarm.service.name=${service}" \
      --format '{{.ID}}'
  )
  for id in "${ids[@]}"; do
    docker inspect --format \
      'CONTAINER={{.Id}} STATUS={{.State.Status}} HEALTH={{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}} HEALTH_HISTORY={{if .State.Health}}{{json .State.Health.Log}}{{else}}[]{{end}}' \
      "$id" 2>&1 | sanitize_migration_output >&2 || true
  done
}

wait_for_one_running_instance() {
  local service="$1"
  local deadline=$((SECONDS + 300))
  local -a task_states
  local -a container_ids

  while (( SECONDS < deadline )); do
    mapfile -t task_states < <(
      docker service ps "$service" --filter desired-state=running \
        --format '{{.CurrentState}}'
    )
    mapfile -t container_ids < <(
      docker ps --filter "label=com.docker.swarm.service.name=${service}" \
        --format '{{.ID}}'
    )
    if [[ "${#task_states[@]}" -eq 1 &&
          "${task_states[0]}" == Running* &&
          "${#container_ids[@]}" -eq 1 ]]; then
      return 0
    fi
    sleep 5
  done

  echo "Esperado exatamente uma task e um container Running para ${service}" >&2
  return 1
}

get_one_running_container_id() {
  local service="$1"
  local -a container_ids
  mapfile -t container_ids < <(
    docker ps --filter "label=com.docker.swarm.service.name=${service}" \
      --format '{{.ID}}'
  )
  [[ "${#container_ids[@]}" -eq 1 ]] || {
    echo "Esperado exatamente um container Running para ${service}" >&2
    return 1
  }
  printf '%s' "${container_ids[0]}"
}

restore_previous_services_after_preflight_failure() {
  local current_app_image
  local current_worker_image
  local current_app_container_id
  local current_worker_container_id
  local current_app_container_image_id
  local current_worker_container_image_id
  local app_replicas
  local worker_replicas
  local cleanup_failed=0

  if cleanup_preflight_service; then
    preflight_service=""
    preflight_env=""
  else
    cleanup_failed=1
  fi

  docker service scale "${stack_name}_worker=1"
  wait_for_one_running_instance "${stack_name}_app"
  wait_for_one_running_instance "${stack_name}_worker"

  current_app_image="$(
    docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' \
      "${stack_name}_app"
  )"
  current_worker_image="$(
    docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' \
      "${stack_name}_worker"
  )"
  app_replicas="$(
    docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' \
      "${stack_name}_app"
  )"
  worker_replicas="$(
    docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' \
      "${stack_name}_worker"
  )"
  current_app_container_id="$(get_one_running_container_id "${stack_name}_app")"
  current_worker_container_id="$(get_one_running_container_id "${stack_name}_worker")"
  current_app_container_image_id="$(
    docker inspect --format '{{.Image}}' "$current_app_container_id"
  )"
  current_worker_container_image_id="$(
    docker inspect --format '{{.Image}}' "$current_worker_container_id"
  )"

  [[ "$current_app_image" == "$previous_app_image" &&
     "$current_worker_image" == "$previous_worker_image" &&
     "$current_app_container_image_id" == "$previous_app_container_image_id" &&
     "$current_worker_container_image_id" == "$previous_worker_container_image_id" &&
     "$app_replicas" == "1" &&
     "$worker_replicas" == "1" ]] || {
    echo "Falha ao confirmar app e worker anteriores apos preflight" >&2
    return 1
  }
  echo "App e worker anteriores confirmados apos falha do preflight"
  (( cleanup_failed == 0 )) || return 1
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
  show_service_health_diagnostics "$service"
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

previous_app_image="$(
  docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' \
    "${stack_name}_app"
)"
previous_worker_image="$(
  docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' \
    "${stack_name}_worker"
)"
previous_app_replicas="$(
  docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' \
    "${stack_name}_app"
)"
previous_worker_replicas="$(
  docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' \
    "${stack_name}_worker"
)"
[[ -n "$previous_app_image" && -n "$previous_worker_image" ]] || {
  echo "Nao foi possivel registrar as imagens anteriores" >&2
  exit 1
}
[[ "$previous_app_replicas" == "1" && "$previous_worker_replicas" == "1" ]] || {
  echo "App e worker anteriores devem iniciar com 1 replica" >&2
  exit 1
}
[[ "$previous_app_image" != "wa-sender-simple:${IMAGE_TAG}" &&
   "$previous_worker_image" != "wa-sender-simple:${IMAGE_TAG}" ]] || {
  echo "IMAGE_TAG deve ser diferente das imagens anteriores" >&2
  exit 1
}
wait_for_one_running_instance "${stack_name}_app"
wait_for_one_running_instance "${stack_name}_worker"
previous_app_container_image_id="$(
  docker inspect --format '{{.Image}}' \
    "$(get_one_running_container_id "${stack_name}_app")"
)"
previous_worker_container_image_id="$(
  docker inspect --format '{{.Image}}' \
    "$(get_one_running_container_id "${stack_name}_worker")"
)"

docker service scale wa_sender_simple_worker=0
BACKUP_ROOT="$BACKUP_ROOT" bash ./scripts/backup.sh
docker build -t "wa-sender-simple:${IMAGE_TAG}" .
echo "Imagem publicada localmente: wa-sender-simple:${IMAGE_TAG}"

if ! run_swarm_preflight; then
  echo "Preflight falhou; restaurando worker anterior" >&2
  restore_previous_services_after_preflight_failure
  exit 1
fi
cleanup_preflight_service
preflight_service=""
preflight_env=""

export APP_REPLICAS=0
export WORKER_REPLICAS=0
docker stack deploy --resolve-image never -c docker-stack.yml "$stack_name"

run_swarm_migration
cleanup_migration_service
migration_service=""
migration_env=""

export APP_REPLICAS=1
docker stack deploy --resolve-image never -c docker-stack.yml "$stack_name"
wait_for_healthy_service wa_sender_simple_app

export WORKER_REPLICAS=1
docker stack deploy --resolve-image never -c docker-stack.yml "$stack_name"
wait_for_healthy_service wa_sender_simple_worker

echo "Deploy concluido com tag: ${IMAGE_TAG}"
echo "Inspecao: docker stack services wa_sender_simple"
echo "Inspecao: docker service ps wa_sender_simple_app --no-trunc"
echo "Inspecao: docker service ps wa_sender_simple_worker --no-trunc"
echo "Nenhuma importacao de leads foi executada."
