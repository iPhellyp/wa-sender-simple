import IORedis from "ioredis";
import { getRedisConnectionOptions } from "../lib/queue/connection";

export const WORKER_HEARTBEAT_KEY = "wa2:worker:heartbeat";
export const WORKER_HEARTBEAT_MAX_AGE_MS = 45_000;

export function createHeartbeatRedis() {
  return new IORedis(getRedisConnectionOptions());
}

export async function recordWorkerHeartbeat(redis: IORedis) {
  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()), "EX", 60);
}
