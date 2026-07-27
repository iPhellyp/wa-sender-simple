import { prisma } from "../lib/prisma/client";
import {
  createHeartbeatRedis,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_MAX_AGE_MS
} from "./heartbeat";

const redis = createHeartbeatRedis();

try {
  await prisma.$queryRaw`SELECT 1`;
  await redis.ping();
  const heartbeat = Number(await redis.get(WORKER_HEARTBEAT_KEY));
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > WORKER_HEARTBEAT_MAX_AGE_MS) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
} finally {
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
}
