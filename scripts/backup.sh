#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

STACK_NAME="${STACK_NAME:-wa_sender_simple}"
BACKUP_ROOT="${BACKUP_ROOT:-./backups}"

[[ "$STACK_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || {
  echo "STACK_NAME invalido" >&2
  exit 1
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${BACKUP_ROOT%/}/${STACK_NAME}/${timestamp}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

find_one_container() {
  local service="$1"
  local -a ids
  mapfile -t ids < <(
    docker ps --filter "label=com.docker.swarm.service.name=${STACK_NAME}_${service}" \
      --format '{{.ID}}'
  )
  [[ "${#ids[@]}" -eq 1 && -n "${ids[0]}" ]] || {
    echo "Esperado exatamente um container para ${STACK_NAME}_${service}" >&2
    exit 1
  }
  printf '%s' "${ids[0]}"
}

postgres_id="$(find_one_container postgres)"
redis_id="$(find_one_container redis)"
app_id="$(find_one_container app)"
worker_replicas="$(
  docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' \
    "${STACK_NAME}_worker"
)"
[[ "$worker_replicas" == "0" ]] || {
  echo "Pause ${STACK_NAME}_worker antes do backup da sessao Baileys" >&2
  exit 1
}

dump_file="${backup_dir}/postgres.dump"
docker exec "$postgres_id" sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$dump_file"
docker exec -i "$postgres_id" pg_restore --list < "$dump_file" > /dev/null

session_file="${backup_dir}/baileys-session.tar.gz"
docker exec "$app_id" tar -C /app/data/baileys-session -czf - . > "$session_file"
tar -tzf "$session_file" > /dev/null

redis_file="${backup_dir}/redis.rdb"
redis_tmp="/tmp/wa2-backup-${timestamp}.rdb"
docker exec "$redis_id" redis-cli --rdb "$redis_tmp" > /dev/null
docker cp "${redis_id}:${redis_tmp}" "$redis_file" > /dev/null
docker exec "$redis_id" rm -f "$redis_tmp"

sha256sum "$dump_file" "$session_file" "$redis_file" > "${backup_dir}/SHA256SUMS"
echo "Backup WA2 verificado em: $backup_dir"
