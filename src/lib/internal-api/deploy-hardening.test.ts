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
  const migration = deploy.indexOf("npm run prisma:deploy");
  const app = deploy.indexOf("APP_REPLICAS=1");
  const worker = deploy.indexOf("WORKER_REPLICAS=1");
  assert.ok(migration > 0 && migration < app && app < worker);
  assert.match(deploy, /\$\{IMAGE_TAG\+x\}/);
  assert.match(deploy, /IMAGE_TAG nao pode ser vazia/);
  assert.doesNotMatch(deploy, /prisma migrate dev|import[-_: ]*lead/i);
  assert.doesNotMatch(deploy, /set -x|echo .*\b(SECRET|PASSWORD|TOKEN)\b/);
});

test("rollback exige tag e backup cobre banco, sessão e Redis", async () => {
  const rollback = await read("scripts/rollback.sh");
  const backup = await read("scripts/backup.sh");
  assert.match(rollback, /target_tag="\$\{1:-\}"/);
  assert.match(rollback, /tag imutavel valida/);
  assert.match(backup, /pg_dump --format=custom/);
  assert.match(backup, /pg_restore --list/);
  assert.match(backup, /baileys-session\.tar\.gz/);
  assert.match(backup, /redis-cli --rdb/);
  assert.match(backup, /sha256sum/);
  assert.match(backup, /worker_replicas/);
  assert.match(backup, /antes do backup da sessao Baileys/);
  const packageJson = JSON.parse(await read("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.scripts?.typecheck, "tsc --noEmit --incremental false");
});
