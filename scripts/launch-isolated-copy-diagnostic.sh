#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE=""
EXPECTED_IMAGE_ID=""
SESSION_DIR=""
CONTAINER_NAME="wa2-receive-diagnostic-run-01"
PRE_FLIGHT_ONLY=false
DURATION_SEC=300
ORIGINAL_VOLUME="wa-sender-simple_baileys_session"

die() { printf 'HOST_LAUNCH_PREFLIGHT_FAILED: %s\n' "$1" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --image) IMAGE="${2:?missing image}"; shift 2 ;;
    --image-id) EXPECTED_IMAGE_ID="${2:?missing image id}"; shift 2 ;;
    --session-dir) SESSION_DIR="${2:?missing session dir}"; shift 2 ;;
    --name) CONTAINER_NAME="${2:?missing name}"; shift 2 ;;
    --duration-sec) DURATION_SEC="${2:?missing duration}"; shift 2 ;;
    --preflight-only) PRE_FLIGHT_ONLY=true; shift ;;
    -h|--help) printf '%s\n' 'launch-isolated-copy-diagnostic.sh --image IMAGE --image-id ID --session-dir PATH [--preflight-only] [--name NAME] [--duration-sec N]'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$IMAGE" && -n "$EXPECTED_IMAGE_ID" && -n "$SESSION_DIR" ]] || die "image, image-id and session-dir are required"
[[ "$SESSION_DIR" = /* ]] || die "session-dir must be absolute"
[[ "$DURATION_SEC" =~ ^[1-9][0-9]*$ ]] || die "duration-sec must be positive"
[[ "$CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die "invalid container name"

actual_image_id="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
[[ "$actual_image_id" = "$EXPECTED_IMAGE_ID" ]] || die "image id mismatch or image missing"
service_line() { docker service ls --format '{{.Name}}|{{.Replicas}}|{{.Image}}' | awk -F'|' -v wanted="$1" '$1 == wanted { print; exit }'; }
require_service() { local line; line="$(service_line "$1")"; [[ "${line#*|}" == "$2|"* ]] || die "unexpected service state: $1"; printf '%s\n' "$line"; }
worker_line="$(require_service wa_sender_simple_worker 0/0)"
app_line="$(require_service wa_sender_simple_app 1/1)"
postgres_line="$(require_service wa_sender_simple_postgres 1/1)"
redis_line="$(require_service wa_sender_simple_redis 1/1)"
baileys_processes="$(ps -eo pid=,args= | grep -E 'sender-worker|node_modules/@whiskeysockets/baileys' | grep -v grep | wc -l | tr -d ' ' || true)"
[[ "$baileys_processes" = 0 ]] || die "Baileys process is active"
diagnostic_containers="$(docker ps --format '{{.Names}}' | awk '/^wa2-receive-diagnostic-/ {count++} END {print count+0}')"
[[ "$diagnostic_containers" = 0 ]] || die "diagnostic container already active"
if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
  die "container name already exists"
fi
[[ -d "$SESSION_DIR" && ! -L "$SESSION_DIR" ]] || die "session directory invalid"
real_session_dir="$(readlink -f -- "$SESSION_DIR")"
[[ "$real_session_dir" != *"$ORIGINAL_VOLUME"* ]] || die "production volume path rejected"
[[ -f "$real_session_dir/creds.json" && -f "$SESSION_DIR.manifest.sha256" ]] || die "session or manifest missing"

planned="docker run -d --name $CONTAINER_NAME --restart no --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --cpus 1 --mount type=bind,src=$real_session_dir,dst=/lab/session-copy $IMAGE node --import tsx /lab/scripts/baileys-receive-diagnostic.ts --run --mode copy --isolated-run --session-dir /lab/session-copy --duration-sec $DURATION_SEC"
if [[ "$PRE_FLIGHT_ONLY" = true ]]; then
  printf 'HOST_LAUNCH_PREFLIGHT_OK\nImage: %s\nImage ID: %s\nWorker: %s\nApp: %s\nPostgres: %s\nRedis: %s\nBaileys processes: %s\nDiagnostic containers: %s\nSession realpath: %s\nDocker socket: NÃO MONTADO\nPlanned command: %s\n' "$IMAGE" "$actual_image_id" "$worker_line" "$app_line" "$postgres_line" "$redis_line" "$baileys_processes" "$diagnostic_containers" "$real_session_dir" "$planned"
  exit 0
fi
[[ "$(service_line wa_sender_simple_worker)" == wa_sender_simple_worker\|0/0\|* ]] || die "worker changed before start"
container_id="$(docker run -d --name "$CONTAINER_NAME" --restart no --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 512m --cpus 1 --mount "type=bind,src=$real_session_dir,dst=/lab/session-copy" "$IMAGE" node --import tsx /lab/scripts/baileys-receive-diagnostic.ts --run --mode copy --isolated-run --session-dir /lab/session-copy --duration-sec "$DURATION_SEC")"
sleep 1
[[ "$(service_line wa_sender_simple_worker)" == wa_sender_simple_worker\|0/0\|* ]] || die "worker changed after start"
printf 'HOST_LAUNCH_STARTED_OK\nContainer: %s\nContainer ID: %s\nWorker: %s\nDocker socket: NÃO MONTADO\nSession copy: %s\n' "$CONTAINER_NAME" "$container_id" "$(service_line wa_sender_simple_worker)" "$real_session_dir"
