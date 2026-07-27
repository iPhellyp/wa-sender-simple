import { createHash } from "crypto";
import { InternalApiError } from "./errors";

export type RateLimitRedis = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRateLimitConfiguration() {
  return {
    limit: positiveInteger(process.env.WA2_INTERNAL_API_RATE_LIMIT, 60),
    windowSeconds: positiveInteger(process.env.WA2_INTERNAL_API_RATE_WINDOW_SECONDS, 60)
  };
}

export async function enforceInternalRateLimit(options: {
  redis: RateLimitRedis;
  consumerHash: string;
  route: string;
  mutation: boolean;
  now?: number;
}) {
  const { limit, windowSeconds } = getRateLimitConfiguration();
  const window = Math.floor((options.now ?? Date.now()) / (windowSeconds * 1000));
  const routeHash = createHash("sha256").update(options.route).digest("hex").slice(0, 24);
  const key = `wa2:internal:rate:${options.consumerHash.slice(0, 24)}:${routeHash}:${window}`;

  try {
    const count = await options.redis.incr(key);
    if (count === 1) {
      await options.redis.expire(key, windowSeconds);
    }

    if (count > limit) {
      const ttl = await options.redis.ttl(key);
      const retryAfter = ttl > 0 ? ttl : windowSeconds;
      throw new InternalApiError("RATE_LIMITED", "Limite de requisições excedido", 429, {
        "Retry-After": String(retryAfter)
      });
    }
  } catch (error) {
    if (error instanceof InternalApiError) {
      throw error;
    }

    if (options.mutation) {
      throw new InternalApiError(
        "DEPENDENCY_UNAVAILABLE",
        "Dependência temporariamente indisponível",
        503
      );
    }

    return { degraded: true };
  }

  return { degraded: false };
}
