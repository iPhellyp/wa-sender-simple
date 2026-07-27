import { createHash } from "crypto";
import { InternalApiError } from "./errors";

export type IdempotencyRedis = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttl: number,
    condition?: "NX"
  ): Promise<"OK" | null>;
  del(key: string): Promise<number>;
};

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type StoredIdempotencyRecord = {
  fingerprint: string;
  state: "processing" | "complete";
  status?: number;
  body?: string;
  contentType?: string;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateIdempotencyKey(value: string | null) {
  if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new InternalApiError(
      "VALIDATION_ERROR",
      "Idempotency-Key inválida ou ausente",
      400
    );
  }

  return value;
}

export function buildIdempotencyFingerprint(method: string, route: string, body: string) {
  return createHash("sha256")
    .update(`${method.toUpperCase()}\n${route}\n${body}`, "utf8")
    .digest("hex");
}

function redisKey(key: string) {
  return `wa2:internal:idempotency:${createHash("sha256").update(key).digest("hex")}`;
}

export async function acquireIdempotency(options: {
  redis: IdempotencyRedis;
  key: string;
  fingerprint: string;
}) {
  const ttl = positiveInteger(process.env.WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS, 86_400);
  const key = redisKey(options.key);
  const processing: StoredIdempotencyRecord = {
    fingerprint: options.fingerprint,
    state: "processing"
  };
  const acquired = await options.redis.set(key, JSON.stringify(processing), "EX", ttl, "NX");

  if (acquired === "OK") {
    return { key, ttl, acquired: true as const };
  }

  const raw = await options.redis.get(key);
  if (!raw) {
    throw new InternalApiError(
      "DEPENDENCY_UNAVAILABLE",
      "Dependência temporariamente indisponível",
      503
    );
  }

  let existing: StoredIdempotencyRecord;
  try {
    existing = JSON.parse(raw) as StoredIdempotencyRecord;
  } catch {
    throw new InternalApiError(
      "DEPENDENCY_UNAVAILABLE",
      "Dependência temporariamente indisponível",
      503
    );
  }

  if (existing.fingerprint !== options.fingerprint) {
    throw new InternalApiError(
      "IDEMPOTENCY_CONFLICT",
      "Idempotency-Key já utilizada com outro pedido",
      409
    );
  }

  if (existing.state === "processing") {
    throw new InternalApiError(
      "IDEMPOTENCY_CONFLICT",
      "Operação idempotente em andamento",
      409,
      { "Retry-After": "1" }
    );
  }

  return { key, ttl, acquired: false as const, response: existing };
}

export async function completeIdempotency(options: {
  redis: IdempotencyRedis;
  key: string;
  ttl: number;
  fingerprint: string;
  status: number;
  body: string;
  contentType: string;
}) {
  const record: StoredIdempotencyRecord = {
    fingerprint: options.fingerprint,
    state: "complete",
    status: options.status,
    body: options.body,
    contentType: options.contentType
  };
  await options.redis.set(options.key, JSON.stringify(record), "EX", options.ttl);
}

export async function abandonIdempotency(redis: IdempotencyRedis, key: string) {
  await redis.del(key).catch(() => undefined);
}
