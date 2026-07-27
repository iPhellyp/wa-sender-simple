import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");

test("stack usa IMAGE_TAG, segredos somente no app e healthchecks", async () => {
  const stack = await read("docker-stack.yml");
  assert.equal((stack.match(/wa-sender-simple:\$\{IMAGE_TAG:\?/g) ?? []).length, 2);
  const appBlock = stack.slice(stack.indexOf("\n  app:"), stack.indexOf("\n  worker:"));
  const workerBlock = stack.slice(stack.indexOf("\n  worker:"), stack.indexOf("\nnetworks:"));
  for (const name of [
    "WA2_INTERNAL_API_SECRET",
    "WA2_INTERNAL_API_PREVIOUS_SECRET",
    "WA2_INTERNAL_API_RATE_LIMIT",
    "WA2_INTERNAL_API_RATE_WINDOW_SECONDS",
    "WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS"
  ]) {
    assert.match(appBlock, new RegExp(`${name}:`));
    assert.doesNotMatch(workerBlock, new RegExp(`${name}:`));
  }
  assert.match(appBlock, /healthcheck:/);
  assert.match(workerBlock, /worker:health/);
});

test("deploy interrompe em migration e atualiza app antes do worker", async () => {
  const deploy = await read("deploy-safe.sh");
  const stack = await read("docker-stack.yml");
  const packageJson = JSON.parse(await read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const migration = deploy.indexOf("npm run prisma:deploy");
  const migrationCall = deploy.lastIndexOf("run_swarm_migration");
  const imageBuilt = deploy.indexOf('docker build -t "wa-sender-simple:${IMAGE_TAG}"');
  const preflightCall = deploy.lastIndexOf("run_swarm_preflight");
  const firstStackDeploy = deploy.indexOf("docker stack deploy");
  const appPaused = deploy.indexOf("APP_REPLICAS=0");
  const workerPaused = deploy.indexOf("WORKER_REPLICAS=0");
  const app = deploy.indexOf("APP_REPLICAS=1");
  const worker = deploy.indexOf("WORKER_REPLICAS=1");
  assert.ok(
    migration > 0 &&
      imageBuilt < preflightCall &&
      preflightCall < firstStackDeploy &&
      preflightCall < appPaused &&
      appPaused < migrationCall &&
      firstStackDeploy < migrationCall &&
      workerPaused < migrationCall &&
      migrationCall < app &&
      app < worker
  );
  assert.doesNotMatch(deploy, /docker run\b/);
  assert.equal(packageJson.scripts?.["worker:preflight"], "tsx src/worker/preflight.ts");
  assert.match(deploy, /docker service create/);
  assert.match(deploy, /--replicas 1/);
  assert.match(deploy, /--restart-condition none/);
  assert.match(deploy, /--constraint 'node\.role==manager'/);
  assert.match(deploy, /--network "\$MIGRATION_NETWORK"/);
  assert.match(
    deploy,
    /MIGRATION_NETWORK="\$\{MIGRATION_NETWORK:-\$\{stack_name\}_wa_sender_internal\}"/
  );
  assert.match(stack, /\n  wa_sender_internal:\s*\n/);
  assert.match(deploy, /local image="wa-sender-simple:\$\{IMAGE_TAG\}"/);
  assert.match(deploy, /"\$image" npm run prisma:deploy/);
  assert.equal((deploy.match(/npm run prisma:deploy/g) ?? []).length, 1);
  assert.match(deploy, /tr -c 'A-Za-z0-9_\.-' '-'/);
  assert.match(deploy, /cut -c1-12/);
  assert.match(deploy, /migration_service="w2m_\$\{safe_tag\}_\$\{epoch\}_\$\$"/);
  assert.doesNotMatch(deploy, /migration_service="crmm_/);
  assert.match(deploy, /MIGRATION_SERVICE_NAME_MAX_LENGTH=63/);
  assert.match(
    deploy,
    /\(\( \$\{#migration_service\} <= MIGRATION_SERVICE_NAME_MAX_LENGTH \)\)/
  );
  assert.match(deploy, /Nome do servico temporario de migration excede 63 caracteres/);
  assert.ok(`w2m_${"a".repeat(12)}_${"9".repeat(10)}_${"9".repeat(7)}`.length <= 63);
  assert.match(deploy, /MIGRATION_TIMEOUT_SECONDS="\$\{MIGRATION_TIMEOUT_SECONDS:-300\}"/);
  assert.match(deploy, /state" == "complete" && "\$exit_code" == "0"/);
  assert.match(deploy, /trap cleanup_migration_on_exit EXIT/);
  assert.match(deploy, /local status=\$\?/);
  assert.match(deploy, /docker service rm "\$migration_service"/);
  assert.match(deploy, /cleanup_failed=1/);
  assert.match(deploy, /run_swarm_migration\s*\ncleanup_migration_service/);
  assert.match(deploy, /sanitize_migration_output/);
  assert.match(deploy, /\^\(complete\|failed\|rejected\|shutdown\|orphaned\|remove\)\$/);
  assert.match(deploy, /\$\{IMAGE_TAG\+x\}/);
  assert.match(deploy, /IMAGE_TAG nao pode ser vazia/);
  assert.doesNotMatch(deploy, /migrate dev|import[-_: ]*lead/i);
  assert.doesNotMatch(deploy, /set -x|echo .*\b(SECRET|PASSWORD|TOKEN)\b/);
});

test("deploy executa preflight temporário seguro e diagnostica timeout de healthcheck", async () => {
  const deploy = await read("deploy-safe.sh");
  const preflightBlock = deploy.slice(
    deploy.indexOf("run_swarm_preflight()"),
    deploy.indexOf("trap cleanup_migration_on_exit EXIT")
  );
  const preflightFailureStart = deploy.indexOf("if ! run_swarm_preflight; then");
  const preflightFailureBlock = deploy.slice(
    preflightFailureStart,
    deploy.indexOf("\ncleanup_preflight_service", preflightFailureStart)
  );
  const restoreBlock = deploy.slice(
    deploy.indexOf("restore_previous_services_after_preflight_failure()"),
    deploy.indexOf("\nwait_for_healthy_service()")
  );
  const preflightCall = deploy.lastIndexOf("run_swarm_preflight");
  const firstStackDeploy = deploy.indexOf("docker stack deploy");

  assert.match(preflightBlock, /local image="wa-sender-simple:\$\{IMAGE_TAG\}"/);
  assert.match(preflightBlock, /preflight_service="w2p_\$\{safe_tag\}_\$\{epoch\}_\$\$"/);
  assert.match(preflightBlock, /cut -c1-12/);
  assert.match(preflightBlock, /PREFLIGHT_SERVICE_NAME_MAX_LENGTH/);
  assert.match(
    preflightBlock,
    /\(\( \$\{#preflight_service\} <= PREFLIGHT_SERVICE_NAME_MAX_LENGTH \)\)/
  );
  assert.ok(`w2p_${"a".repeat(12)}_${"9".repeat(10)}_${"9".repeat(7)}`.length <= 63);
  assert.match(
    deploy,
    /PREFLIGHT_TIMEOUT_SECONDS="\$\{PREFLIGHT_TIMEOUT_SECONDS:-120\}"/
  );
  assert.match(preflightBlock, /--restart-condition none/);
  assert.match(preflightBlock, /--constraint 'node\.role==manager'/);
  assert.match(preflightBlock, /--network "\$MIGRATION_NETWORK"/);
  assert.match(preflightBlock, /"\$image" npm run worker:preflight/);
  assert.match(
    preflightBlock,
    /printf 'DATABASE_URL=%s\\nREDIS_URL=%s\\n'[\s\S]*"\$DATABASE_URL" "\$REDIS_URL" > "\$preflight_env"/
  );
  assert.doesNotMatch(
    preflightBlock.slice(
      preflightBlock.indexOf("printf 'DATABASE_URL"),
      preflightBlock.indexOf("if ! create_output")
    ),
    /ADMIN_PASSWORD|WA2_INTERNAL_API_SECRET|POSTGRES_PASSWORD/
  );
  assert.match(deploy, /docker service rm "\$preflight_service"/);
  assert.match(deploy, /rm -f -- "\$preflight_env"/);
  assert.match(deploy, /cleanup_preflight_service \|\| true/);
  assert.ok(preflightCall > 0 && preflightCall < firstStackDeploy);
  assert.equal(deploy.slice(0, preflightCall).includes("docker stack deploy"), false);
  assert.match(
    preflightFailureBlock,
    /restore_previous_services_after_preflight_failure/
  );
  assert.doesNotMatch(
    preflightFailureBlock,
    /run_swarm_migration|docker stack deploy|APP_REPLICAS=|--image/
  );
  assert.match(restoreBlock, /if cleanup_preflight_service; then/);
  assert.match(restoreBlock, /cleanup_failed=1/);
  assert.match(
    restoreBlock,
    /docker service scale "\$\{stack_name\}_worker=1"/
  );
  assert.match(
    restoreBlock,
    /wait_for_one_running_instance "\$\{stack_name\}_worker"/
  );
  assert.match(
    restoreBlock,
    /"\$current_app_image" == "\$previous_app_image"/
  );
  assert.match(
    restoreBlock,
    /"\$current_worker_image" == "\$previous_worker_image"/
  );
  assert.match(
    restoreBlock,
    /"\$current_app_container_image_id" == "\$previous_app_container_image_id"/
  );
  assert.match(
    restoreBlock,
    /"\$current_worker_container_image_id" == "\$previous_worker_container_image_id"/
  );
  assert.doesNotMatch(restoreBlock, /docker service scale "\$\{stack_name\}_app=/);
  assert.match(
    deploy,
    /previous_app_image="\$\([\s\S]*docker service inspect[\s\S]*"\$\{stack_name\}_app"[\s\S]*\)"/
  );
  assert.match(deploy, /IMAGE_TAG deve ser diferente das imagens anteriores/);
  assert.match(deploy, /docker service ps "\$service" --no-trunc/);
  assert.match(deploy, /docker service logs "\$service" --tail 150/);
  assert.match(deploy, /HEALTH_HISTORY=/);
  assert.match(deploy, /show_service_health_diagnostics "\$service"/);
  assert.doesNotMatch(deploy, /docker run\b/);
});

test("rollback exige tag e backup cobre banco, sessão e Redis", async () => {
  const deploy = await read("deploy-safe.sh");
  const rollback = await read("scripts/rollback.sh");
  const backup = await read("scripts/backup.sh");
  assert.doesNotMatch(`${deploy}\n${rollback}`, /docker run\b|migrate dev/);
  assert.match(rollback, /target_tag="\$\{1:-\}"/);
  assert.match(rollback, /tag imutavel valida/);
  assert.equal((rollback.match(/--no-healthcheck/g) ?? []).length, 2);
  assert.match(
    rollback,
    /docker service update --detach=true --no-healthcheck --image "\$image" "\$\{stack_name\}_app"/
  );
  assert.match(rollback, /docker service scale "\$\{stack_name\}_app=1"/);
  assert.match(rollback, /wait_for_one_running_instance "\$\{stack_name\}_app"/);
  assert.match(rollback, /desired-state=running/);
  assert.match(rollback, /"\$\{#task_states\[@\]\}" -eq 1/);
  assert.match(rollback, /"\$\{task_states\[0\]\}" == Running\*/);
  assert.match(rollback, /"\$\{#container_ids\[@\]\}" -eq 1/);
  assert.match(rollback, /trap ensure_app_not_paused_on_exit EXIT/);
  assert.match(
    rollback,
    /"\$app_replicas" == "0" && "\$worker_replicas" == "0"/
  );
  assert.doesNotMatch(rollback, /\.State\.Health|app=0/);
  const keepPaused = rollback.indexOf('KEEP_WORKER_PAUSED:-false}" == "true"');
  const appRunning = rollback.indexOf('wait_for_one_running_instance "${stack_name}_app"');
  const workerRunning = rollback.indexOf('docker service scale "${stack_name}_worker=1"');
  assert.ok(appRunning > 0 && appRunning < keepPaused && keepPaused < workerRunning);
  assert.equal((rollback.match(/worker=0/g) ?? []).length, 1);
  assert.equal((rollback.match(/worker=1/g) ?? []).length, 1);
  assert.match(backup, /pg_dump --format=custom/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /baileys-session\.tar\.gz/);
  assert.match(backup, /redis-cli --rdb/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /worker_replicas/);
  assert.match(backup, /antes do backup da sessao Baileys/);
  assert.match(backup, /BACKUP_ROOT="\$\{BACKUP_ROOT:-\/root\/wa-sender-simple-backups\}"/);
  assert.match(
    deploy,
    /BACKUP_ROOT="\$BACKUP_ROOT" bash \.\/scripts\/backup\.sh/
  );
  assert.match(deploy, /docker service rm "\$migration_service"/);
  const packageJson = JSON.parse(await read("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.scripts?.typecheck, "tsc --noEmit --incremental false");
});
