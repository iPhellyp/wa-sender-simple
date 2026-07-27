import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import IORedis from "ioredis";
import { getRedisConnectionOptions } from "../lib/queue/connection";
import { withTimeout } from "./timeout";

const PREFLIGHT_OPERATION_TIMEOUT_MS = 5_000;
const PREFLIGHT_CLOSE_TIMEOUT_MS = 2_000;
const PREFLIGHT_KEY_TTL_SECONDS = 30;
const PREFLIGHT_KEY_PREFIX = "wa2:worker:preflight:";

export type WorkerPreflightCode =
  | "WORKER_PREFLIGHT_OK"
  | "WORKER_PREFLIGHT_DATABASE_FAILED"
  | "WORKER_PREFLIGHT_REDIS_FAILED"
  | "WORKER_PREFLIGHT_WRITE_FAILED"
  | "WORKER_PREFLIGHT_READ_FAILED"
  | "WORKER_PREFLIGHT_CLEANUP_FAILED";

export type WorkerPreflightResult = {
  ok: boolean;
  code: WorkerPreflightCode;
};

export type WorkerPreflightDependencies = {
  checkDatabase: () => Promise<unknown>;
  pingRedis: () => Promise<unknown>;
  writeRedis: (key: string, value: string, ttlSeconds: number) => Promise<unknown>;
  readRedis: (key: string) => Promise<string | null>;
  deleteRedis: (key: string) => Promise<unknown>;
  randomIdentifier?: () => string;
  operationTimeoutMs?: number;
};

class WorkerPreflightFailure extends Error {
  constructor(readonly code: WorkerPreflightCode) {
    super(code);
  }
}

export async function runWorkerPreflight(
  dependencies: WorkerPreflightDependencies
): Promise<WorkerPreflightResult> {
  const operationTimeoutMs =
    dependencies.operationTimeoutMs ?? PREFLIGHT_OPERATION_TIMEOUT_MS;
  const identifier = (dependencies.randomIdentifier ?? randomUUID)();
  const key = `${PREFLIGHT_KEY_PREFIX}${identifier}`;
  const value = `ok:${identifier}`;
  let result: WorkerPreflightResult = {
    ok: false,
    code: "WORKER_PREFLIGHT_DATABASE_FAILED"
  };

  try {
    await withTimeout(dependencies.checkDatabase(), operationTimeoutMs).catch(
      () => {
        throw new WorkerPreflightFailure("WORKER_PREFLIGHT_DATABASE_FAILED");
      }
    );
    await withTimeout(dependencies.pingRedis(), operationTimeoutMs).catch(() => {
      throw new WorkerPreflightFailure("WORKER_PREFLIGHT_REDIS_FAILED");
    });
    await withTimeout(
      dependencies.writeRedis(key, value, PREFLIGHT_KEY_TTL_SECONDS),
      operationTimeoutMs
    ).catch(() => {
      throw new WorkerPreflightFailure("WORKER_PREFLIGHT_WRITE_FAILED");
    });
    const storedValue = await withTimeout(
      dependencies.readRedis(key),
      operationTimeoutMs
    ).catch(() => {
      throw new WorkerPreflightFailure("WORKER_PREFLIGHT_READ_FAILED");
    });

    if (storedValue !== value) {
      throw new WorkerPreflightFailure("WORKER_PREFLIGHT_READ_FAILED");
    }

    result = { ok: true, code: "WORKER_PREFLIGHT_OK" };
  } catch (error) {
    result = {
      ok: false,
      code:
        error instanceof WorkerPreflightFailure
          ? error.code
          : "WORKER_PREFLIGHT_REDIS_FAILED"
    };
  } finally {
    try {
      await withTimeout(dependencies.deleteRedis(key), operationTimeoutMs);
    } catch {
      if (result.ok) {
        result = { ok: false, code: "WORKER_PREFLIGHT_CLEANUP_FAILED" };
      }
    }
  }

  return result;
}

async function closePreflightResources(
  redis: IORedis | null,
  preflightPrisma: PrismaClient
) {
  if (redis) {
    try {
      await withTimeout(redis.quit(), PREFLIGHT_CLOSE_TIMEOUT_MS);
    } catch {
      redis.disconnect();
    }
  }
  await withTimeout(
    preflightPrisma.$disconnect(),
    PREFLIGHT_CLOSE_TIMEOUT_MS
  ).catch(() => undefined);
}

async function main() {
  const preflightPrisma = new PrismaClient({ log: [] });
  let redis: IORedis | null = null;

  const getRedis = () => {
    if (!redis) {
      redis = new IORedis({
        ...getRedisConnectionOptions(),
        connectTimeout: PREFLIGHT_OPERATION_TIMEOUT_MS,
        lazyConnect: true,
        maxRetriesPerRequest: 1
      });
      redis.on("error", () => undefined);
    }
    return redis;
  };

  try {
    const result = await runWorkerPreflight({
      checkDatabase: () => preflightPrisma.$queryRaw`SELECT 1`,
      pingRedis: async () => {
        const client = getRedis();
        await client.connect();
        return client.ping();
      },
      writeRedis: (key, value, ttlSeconds) =>
        getRedis().set(key, value, "EX", ttlSeconds),
      readRedis: (key) => getRedis().get(key),
      deleteRedis: (key) => (redis ? redis.del(key) : Promise.resolve(0))
    });

    if (result.ok) {
      console.log(result.code);
      return;
    }

    console.error(result.code);
    process.exitCode = 1;
  } finally {
    await closePreflightResources(redis, preflightPrisma);
  }
}

if (require.main === module) {
  void main().catch(() => {
    console.error("WORKER_PREFLIGHT_DATABASE_FAILED");
    process.exitCode = 1;
  });
}
