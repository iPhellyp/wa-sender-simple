import Redis from "ioredis";

let redis: Redis | null = null;

export function getInternalApiRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 1
    });
    redis.on("error", () => undefined);
  }

  return redis;
}
