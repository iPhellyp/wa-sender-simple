import { PrismaClient } from "@prisma/client";
import {
  createHeartbeatRedis,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_MAX_AGE_MS,
  WORKER_READINESS_KEY,
  WORKER_READINESS_MAX_AGE_MS
} from "./heartbeat";
import { withTimeout } from "./timeout";

const HEALTH_OPERATION_TIMEOUT_MS = 5_000;
const HEALTH_CLOSE_TIMEOUT_MS = 2_000;

export type WorkerHealthCode =
  | "WORKER_HEALTH_OK"
  | "WORKER_HEALTH_DATABASE_FAILED"
  | "WORKER_HEALTH_REDIS_FAILED"
  | "WORKER_HEALTH_HEARTBEAT_MISSING"
  | "WORKER_HEALTH_HEARTBEAT_INVALID"
  | "WORKER_HEALTH_HEARTBEAT_STALE"
  | "WORKER_HEALTH_READINESS_MISSING"
  | "WORKER_HEALTH_READINESS_INVALID"
  | "WORKER_HEALTH_READINESS_STALE";

export type WorkerHealthResult = {
  ok: boolean;
  code: WorkerHealthCode;
  ageMs?: number;
};

export type WorkerHealthDependencies = {
  checkDatabase: () => Promise<unknown>;
  pingRedis: () => Promise<unknown>;
  readHeartbeat: () => Promise<string | null>;
  readReadiness: () => Promise<string | null>;
  now: () => number;
  operationTimeoutMs?: number;
  heartbeatMaxAgeMs?: number;
  readinessMaxAgeMs?: number;
};

export async function checkWorkerHealth(
  dependencies: WorkerHealthDependencies
): Promise<WorkerHealthResult> {
  const operationTimeoutMs =
    dependencies.operationTimeoutMs ?? HEALTH_OPERATION_TIMEOUT_MS;
  const heartbeatMaxAgeMs =
    dependencies.heartbeatMaxAgeMs ?? WORKER_HEARTBEAT_MAX_AGE_MS;
  const readinessMaxAgeMs =
    dependencies.readinessMaxAgeMs ?? WORKER_READINESS_MAX_AGE_MS;

  try {
    await withTimeout(dependencies.checkDatabase(), operationTimeoutMs);
  } catch {
    return { ok: false, code: "WORKER_HEALTH_DATABASE_FAILED" };
  }

  try {
    await withTimeout(dependencies.pingRedis(), operationTimeoutMs);
  } catch {
    return { ok: false, code: "WORKER_HEALTH_REDIS_FAILED" };
  }

  let heartbeat: string | null;
  try {
    heartbeat = await withTimeout(
      dependencies.readHeartbeat(),
      operationTimeoutMs
    );
  } catch {
    return { ok: false, code: "WORKER_HEALTH_REDIS_FAILED" };
  }

  if (heartbeat === null) {
    return { ok: false, code: "WORKER_HEALTH_HEARTBEAT_MISSING" };
  }

  if (!/^\d+$/.test(heartbeat)) {
    return { ok: false, code: "WORKER_HEALTH_HEARTBEAT_INVALID" };
  }

  const heartbeatTimestamp = Number(heartbeat);
  if (!Number.isSafeInteger(heartbeatTimestamp) || heartbeatTimestamp <= 0) {
    return { ok: false, code: "WORKER_HEALTH_HEARTBEAT_INVALID" };
  }

  const ageMs = dependencies.now() - heartbeatTimestamp;
  if (ageMs > heartbeatMaxAgeMs) {
    return {
      ok: false,
      code: "WORKER_HEALTH_HEARTBEAT_STALE",
      ageMs
    };
  }

  let readiness: string | null;
  try {
    readiness = await withTimeout(
      dependencies.readReadiness(),
      operationTimeoutMs
    );
  } catch {
    return { ok: false, code: "WORKER_HEALTH_REDIS_FAILED" };
  }

  if (readiness === null) {
    return { ok: false, code: "WORKER_HEALTH_READINESS_MISSING" };
  }

  if (!/^\d+$/.test(readiness)) {
    return { ok: false, code: "WORKER_HEALTH_READINESS_INVALID" };
  }

  const readinessTimestamp = Number(readiness);
  if (!Number.isSafeInteger(readinessTimestamp) || readinessTimestamp <= 0) {
    return { ok: false, code: "WORKER_HEALTH_READINESS_INVALID" };
  }

  const readinessAgeMs = dependencies.now() - readinessTimestamp;
  if (readinessAgeMs > readinessMaxAgeMs) {
    return {
      ok: false,
      code: "WORKER_HEALTH_READINESS_STALE",
      ageMs: readinessAgeMs
    };
  }

  return { ok: true, code: "WORKER_HEALTH_OK" };
}

export function formatWorkerHealthResult(result: WorkerHealthResult) {
  return result.code === "WORKER_HEALTH_HEARTBEAT_STALE" ||
    result.code === "WORKER_HEALTH_READINESS_STALE"
    ? `${result.code} ageMs=${result.ageMs}`
    : result.code;
}

async function closeHealthResources(
  redis: ReturnType<typeof createHeartbeatRedis> | null,
  healthPrisma: PrismaClient
) {
  if (redis) {
    try {
      await withTimeout(redis.quit(), HEALTH_CLOSE_TIMEOUT_MS);
    } catch {
      redis.disconnect();
    }
  }
  await withTimeout(healthPrisma.$disconnect(), HEALTH_CLOSE_TIMEOUT_MS).catch(
    () => undefined
  );
}

async function main() {
  const healthPrisma = new PrismaClient({ log: [] });
  let redis: ReturnType<typeof createHeartbeatRedis> | null = null;

  const getRedis = () => {
    if (!redis) {
      redis = createHeartbeatRedis();
      redis.on("error", () => undefined);
    }
    return redis;
  };

  try {
    const result = await checkWorkerHealth({
      checkDatabase: () => healthPrisma.$queryRaw`SELECT 1`,
      pingRedis: () => getRedis().ping(),
      readHeartbeat: () => getRedis().get(WORKER_HEARTBEAT_KEY),
      readReadiness: () => getRedis().get(WORKER_READINESS_KEY),
      now: Date.now
    });
    const message = formatWorkerHealthResult(result);

    if (result.ok) {
      console.log(message);
      return;
    }

    console.error(message);
    process.exitCode = 1;
  } finally {
    await closeHealthResources(redis, healthPrisma);
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error("WORKER_HEALTH_DATABASE_FAILED");
    process.exitCode = 1;
  });
}
