import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  checkWorkerHealth,
  formatWorkerHealthResult,
  type WorkerHealthDependencies
} from "./healthcheck";
import {
  runWorkerPreflight,
  type WorkerPreflightDependencies
} from "./preflight";

const read = (path: string) => readFile(resolve(process.cwd(), path), "utf8");
const sensitivePattern =
  /postgres(?:ql)?:\/\/|redis:\/\/|password|token|secret|super-secret/i;

function healthDependencies(
  overrides: Partial<WorkerHealthDependencies> = {}
): WorkerHealthDependencies {
  return {
    checkDatabase: async () => 1,
    pingRedis: async () => "PONG",
    readHeartbeat: async () => "9950",
    readReadiness: async () => "9950",
    now: () => 10_000,
    operationTimeoutMs: 50,
    heartbeatMaxAgeMs: 1_000,
    readinessMaxAgeMs: 1_000,
    ...overrides
  };
}

test("healthcheck distingue banco, Redis e estados do heartbeat sem vazar erros", async () => {
  const database = await checkWorkerHealth(
    healthDependencies({
      checkDatabase: async () => {
        throw new Error("postgresql://user:super-secret@database");
      }
    })
  );
  const redis = await checkWorkerHealth(
    healthDependencies({
      pingRedis: async () => {
        throw new Error("redis://:password@redis token=super-secret");
      }
    })
  );
  const missing = await checkWorkerHealth(
    healthDependencies({ readHeartbeat: async () => null })
  );
  const invalid = await checkWorkerHealth(
    healthDependencies({ readHeartbeat: async () => "not-a-number" })
  );
  const empty = await checkWorkerHealth(
    healthDependencies({ readHeartbeat: async () => "" })
  );
  const stale = await checkWorkerHealth(
    healthDependencies({ readHeartbeat: async () => "8000" })
  );
  const readinessMissing = await checkWorkerHealth(
    healthDependencies({ readReadiness: async () => null })
  );
  const readinessInvalid = await checkWorkerHealth(
    healthDependencies({ readReadiness: async () => "not-a-number" })
  );
  const readinessStale = await checkWorkerHealth(
    healthDependencies({ readReadiness: async () => "8000" })
  );
  const healthy = await checkWorkerHealth(healthDependencies());

  assert.deepEqual(database, {
    ok: false,
    code: "WORKER_HEALTH_DATABASE_FAILED"
  });
  assert.deepEqual(redis, {
    ok: false,
    code: "WORKER_HEALTH_REDIS_FAILED"
  });
  assert.deepEqual(missing, {
    ok: false,
    code: "WORKER_HEALTH_HEARTBEAT_MISSING"
  });
  assert.deepEqual(invalid, {
    ok: false,
    code: "WORKER_HEALTH_HEARTBEAT_INVALID"
  });
  assert.deepEqual(empty, {
    ok: false,
    code: "WORKER_HEALTH_HEARTBEAT_INVALID"
  });
  assert.deepEqual(stale, {
    ok: false,
    code: "WORKER_HEALTH_HEARTBEAT_STALE",
    ageMs: 2_000
  });
  assert.deepEqual(readinessMissing, {
    ok: false,
    code: "WORKER_HEALTH_READINESS_MISSING"
  });
  assert.deepEqual(readinessInvalid, {
    ok: false,
    code: "WORKER_HEALTH_READINESS_INVALID"
  });
  assert.deepEqual(readinessStale, {
    ok: false,
    code: "WORKER_HEALTH_READINESS_STALE",
    ageMs: 2_000
  });
  assert.deepEqual(healthy, { ok: true, code: "WORKER_HEALTH_OK" });

  for (const result of [
    database,
    redis,
    missing,
    invalid,
    empty,
    stale,
    readinessMissing,
    readinessInvalid,
    readinessStale,
    healthy
  ]) {
    assert.doesNotMatch(formatWorkerHealthResult(result), sensitivePattern);
  }
  assert.equal(
    formatWorkerHealthResult(stale),
    "WORKER_HEALTH_HEARTBEAT_STALE ageMs=2000"
  );
  assert.equal(
    formatWorkerHealthResult(readinessStale),
    "WORKER_HEALTH_READINESS_STALE ageMs=2000"
  );
});

test("preflight usa chave exclusiva, TTL curto, valida valor e remove no finally", async () => {
  const keys: string[] = [];
  const deleted: string[] = [];
  const ttlValues: number[] = [];
  const stored = new Map<string, string>();

  const dependencies = (
    identifier: string
  ): WorkerPreflightDependencies => ({
    checkDatabase: async () => 1,
    pingRedis: async () => "PONG",
    writeRedis: async (key, value, ttlSeconds) => {
      keys.push(key);
      ttlValues.push(ttlSeconds);
      stored.set(key, value);
    },
    readRedis: async (key) => stored.get(key) ?? null,
    deleteRedis: async (key) => {
      deleted.push(key);
      stored.delete(key);
    },
    randomIdentifier: () => identifier,
    operationTimeoutMs: 50
  });

  const first = await runWorkerPreflight(dependencies("first-id"));
  const second = await runWorkerPreflight(dependencies("second-id"));

  assert.deepEqual(first, { ok: true, code: "WORKER_PREFLIGHT_OK" });
  assert.deepEqual(second, { ok: true, code: "WORKER_PREFLIGHT_OK" });
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys.every((key) => key.startsWith("wa2:worker:preflight:")));
  assert.ok(keys.every((key) => key !== "wa2:worker:heartbeat"));
  assert.deepEqual(ttlValues, [30, 30]);
  assert.deepEqual(deleted, keys);
  assert.equal(stored.size, 0);
});

test("preflight não cria BullMQ, não usa heartbeat real e emite somente códigos seguros", async () => {
  const preflight = await read("src/worker/preflight.ts");
  assert.doesNotMatch(preflight, /from ["']bullmq["']|new Worker\s*\(/);
  assert.doesNotMatch(preflight, /wa2:worker:heartbeat/);
  assert.doesNotMatch(
    preflight,
    /campaign|baileys|whatsapp|CAMPAIGN_QUEUE_NAME/i
  );

  const result = await runWorkerPreflight({
    checkDatabase: async () => {
      throw new Error("postgresql://user:password@database token=secret");
    },
    pingRedis: async () => "PONG",
    writeRedis: async () => undefined,
    readRedis: async () => null,
    deleteRedis: async () => undefined,
    randomIdentifier: () => "safe-id",
    operationTimeoutMs: 50
  });

  assert.equal(result.code, "WORKER_PREFLIGHT_DATABASE_FAILED");
  assert.doesNotMatch(result.code, sensitivePattern);
});

test("readiness BullMQ antecede chave readiness e scheduler, com cleanup seguro", async () => {
  const sender = await read("src/worker/sender-worker.ts");
  const initialHeartbeat = sender.indexOf(
    "recordWorkerHeartbeat(heartbeatRedis),\n    HEARTBEAT_INITIALIZATION_TIMEOUT_MS"
  );
  const clearPreviousReadiness = sender.indexOf(
    "removeWorkerReadiness(heartbeatRedis),\n    HEARTBEAT_INITIALIZATION_TIMEOUT_MS"
  );
  const heartbeatTimer = sender.indexOf("const heartbeatTimer = setInterval");
  const worker = sender.indexOf("worker = new Worker(");
  const waitUntilReady = sender.indexOf("worker.waitUntilReady()");
  const readiness = sender.indexOf(
    "recordWorkerReadiness(heartbeatRedis),",
    waitUntilReady
  );
  const readinessTimer = sender.indexOf(
    "readinessTimer = setInterval",
    readiness
  );
  const scheduler = sender.indexOf("campaignScheduler = startCampaignScheduler()");
  const initialFailure = sender.indexOf(
    'console.error("WORKER_HEARTBEAT_INITIALIZATION_FAILED")'
  );
  const exitAfterFailure = sender.indexOf("process.exit(1)", initialFailure);

  assert.ok(
    clearPreviousReadiness > 0 &&
      clearPreviousReadiness < initialHeartbeat &&
      initialHeartbeat < heartbeatTimer &&
      heartbeatTimer < worker &&
      worker < waitUntilReady &&
      waitUntilReady < readiness &&
      readiness < readinessTimer &&
      readinessTimer < scheduler
  );
  assert.ok(
    initialFailure > initialHeartbeat &&
      exitAfterFailure > initialFailure &&
      exitAfterFailure < worker
  );
  assert.match(sender, /\}, 15_000\);/);
  assert.match(sender, /\[worker\] heartbeat initialized/);
  assert.match(sender, /WORKER_BULLMQ_READINESS_FAILED/);
  assert.match(sender, /WORKER_READINESS_PERIODIC_FAILED/);
  assert.match(sender, /clearInterval\(heartbeatTimer\)/);
  assert.match(sender, /clearInterval\(readinessTimer\)/);
  assert.match(sender, /closeWorkerRuntimeResources\(worker\)/);
  assert.match(sender, /removeWorkerReadiness\(heartbeatRedis\)/);
  const readinessFailure = sender.indexOf(
    'console.error("WORKER_BULLMQ_READINESS_FAILED")',
    waitUntilReady
  );
  const exitAfterReadinessFailure = sender.indexOf(
    "process.exit(1)",
    readinessFailure
  );
  assert.ok(
    readinessFailure > waitUntilReady &&
      exitAfterReadinessFailure > readinessFailure &&
      exitAfterReadinessFailure < scheduler
  );
});
