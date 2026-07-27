import IORedis from "ioredis";
import { getRedisConnectionOptions } from "../lib/queue/connection";

export const WORKER_HEARTBEAT_KEY = "wa2:worker:heartbeat";
export const WORKER_HEARTBEAT_MAX_AGE_MS = 45_000;
export const WORKER_READINESS_KEY = "wa2:worker:ready";
export const WORKER_READINESS_MAX_AGE_MS = 45_000;

export function createHeartbeatRedis() {
  return new IORedis(getRedisConnectionOptions());
}

export async function recordWorkerHeartbeat(redis: IORedis) {
  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 60);
}

export async function recordWorkerReadiness(redis: IORedis) {
  await redis.set(WORKER_READINESS_KEY, String(Date.now()), "EX", 60);
}

export async function removeWorkerReadiness(redis: IORedis) {
  await redis.del(WORKER_READINESS_KEY);
}
