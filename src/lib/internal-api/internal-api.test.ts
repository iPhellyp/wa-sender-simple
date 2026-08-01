import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { authenticateInternalRequest, compareSecretHashes } from "./auth";
import { InternalApiError } from "./errors";
import {
  acquireIdempotency,
  buildIdempotencyFingerprint,
  completeIdempotency,
  validateIdempotencyKey,
  type IdempotencyRedis
} from "./idempotency";
import { classifyJid } from "./jid";
import { withInternalApi } from "./handler";
import { enforceInternalRateLimit, type RateLimitRedis } from "./rate-limit";
import { resolveRequestId } from "./request-id";
import {
  parseConnectBody,
  parseCreateInstanceBody,
  parseDisconnectBody,
  parseSyncBody,
  validatePhone
} from "./schemas";
import { internalJson } from "./response";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("autentica o segredo atual sem expô-lo", () => {
  const result = authenticateInternalRequest("Bearer current-secret", {
    current: "current-secret"
  });
  assert.match(result.consumerHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(result.consumerHash, /current-secret/);
});

test("aceita o segredo anterior opcional", () => {
  assert.doesNotThrow(() =>
    authenticateInternalRequest("Bearer previous-secret", {
      current: "current-secret",
      previous: "previous-secret"
    })
  );
});

for (const authorization of [null, "Bearer invalid-secret", "Basic value"]) {
  test(`rejeita autorização inválida: ${authorization ?? "ausente"}`, () => {
    assert.throws(
      () => authenticateInternalRequest(authorization, { current: "current-secret" }),
      (error: unknown) => error instanceof InternalApiError && error.code === "UNAUTHORIZED"
    );
  });
}

test("configuração de segredo ausente deixa a API indisponível", () => {
  assert.throws(
    () => authenticateInternalRequest("Bearer value", {}),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "DEPENDENCY_UNAVAILABLE"
  );
});

test("comparação usa hashes de tamanho fixo", () => {
  assert.equal(compareSecretHashes("same", "same"), true);
  assert.equal(compareSecretHashes("short", "a-much-longer-secret"), false);
});

test("preserva request ID UUID válido", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(resolveRequestId(id), id);
});

test("substitui request ID inválido ou ausente", () => {
  assert.match(resolveRequestId("invalid"), /^[0-9a-f-]{36}$/);
  assert.match(resolveRequestId(null), /^[0-9a-f-]{36}$/);
});

test("valida schemas estritos", () => {
  assert.deepEqual(parseCreateInstanceBody({ name: "CRM", role: "GENERAL" }), {
    name: "CRM",
    role: "GENERAL"
  });
  assert.deepEqual(parseConnectBody({ mode: "auto" }), { mode: "auto" });
  assert.deepEqual(parseSyncBody({ scope: "history" }), { scope: "history" });
  assert.deepEqual(parseDisconnectBody({ preserveSession: true }), {
    preserveSession: true
  });
  assert.throws(() => parseConnectBody({ mode: "reset" }));
  assert.throws(() => parseSyncBody({ scope: "all" }));
  assert.throws(() => parseDisconnectBody({ preserveSession: false }));
  assert.throws(() => parseCreateInstanceBody({ name: "CRM", unknown: true }));
});

test("normaliza telefone nacional e DDI 55 sem alterar o nono dígito", () => {
  assert.equal(validatePhone("11 98765-4321"), "5511987654321");
  assert.equal(validatePhone("+55 11 8765-4321"), "551187654321");
  assert.throws(() => validatePhone("123"));
});

test("classifica JIDs e bloqueios esperados", () => {
  assert.equal(classifyJid("5511987654321@s.whatsapp.net"), "individual_phone");
  assert.equal(classifyJid("123@lid"), "lid");
  assert.equal(classifyJid("123@g.us"), "group");
  assert.equal(classifyJid("status@broadcast"), "status");
  assert.equal(classifyJid("123@broadcast"), "broadcast");
  assert.equal(classifyJid("123@newsletter"), "newsletter");
  assert.equal(classifyJid("123@unknown"), "unsupported");
});

class MemoryIdempotencyRedis implements IdempotencyRedis {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _expiryMode: "EX",
    _ttl: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    if (condition === "NX" && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string) {
    return this.values.delete(key) ? 1 : 0;
  }
}

test("idempotência adquire, conclui e reproduz a primeira resposta", async () => {
  const previousTtl = process.env.WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS;
  process.env.WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS = "120";
  const redis = new MemoryIdempotencyRedis();
  const fingerprint = buildIdempotencyFingerprint("POST", "/route", "{}");
  const first = await acquireIdempotency({ redis, key: "request-123", fingerprint });
  assert.equal(first.acquired, true);
  assert.equal(first.ttl, 120);
  await completeIdempotency({
    redis,
    key: first.key,
    ttl: first.ttl,
    fingerprint,
    status: 202,
    body: "{\"ok\":true}",
    contentType: "application/json"
  });
  const replay = await acquireIdempotency({ redis, key: "request-123", fingerprint });
  assert.equal(replay.acquired, false);
  if (!replay.acquired) assert.equal(replay.response.status, 202);
  restoreEnv("WA2_INTERNAL_API_IDEMPOTENCY_TTL_SECONDS", previousTtl);
});

test("idempotência rejeita payload diferente e operação em andamento", async () => {
  const redis = new MemoryIdempotencyRedis();
  const fingerprint = buildIdempotencyFingerprint("POST", "/route", "{}");
  await acquireIdempotency({ redis, key: "request-456", fingerprint });
  await assert.rejects(
    acquireIdempotency({
      redis,
      key: "request-456",
      fingerprint: buildIdempotencyFingerprint("POST", "/route", "{\"x\":1}")
    }),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    acquireIdempotency({ redis, key: "request-456", fingerprint }),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("idempotência rejeita chave inválida", () => {
  assert.throws(() => validateIdempotencyKey("short"));
  assert.equal(validateIdempotencyKey("valid-key-123"), "valid-key-123");
});

class MemoryRateRedis implements RateLimitRedis {
  count = 0;
  fail = false;
  async incr() {
    if (this.fail) throw new Error("unavailable");
    return ++this.count;
  }
  async expire() {
    return 1;
  }
  async ttl() {
    return 10;
  }
}

class MemoryInternalRedis extends MemoryIdempotencyRedis implements RateLimitRedis {
  count = 0;
  async incr() {
    return ++this.count;
  }
  async expire() {
    return 1;
  }
  async ttl() {
    return 10;
  }
}

class FailingCompletionRedis extends MemoryInternalRedis {
  async set(
    key: string,
    value: string,
    expiryMode: "EX",
    ttl: number,
    condition?: "NX"
  ): Promise<"OK" | null> {
    if (condition !== "NX") {
      throw new Error("completion unavailable");
    }
    return super.set(key, value, expiryMode, ttl, condition);
  }
}

test("rate limit permite e depois bloqueia com Retry-After", async () => {
  const previous = process.env.WA2_INTERNAL_API_RATE_LIMIT;
  process.env.WA2_INTERNAL_API_RATE_LIMIT = "1";
  const redis = new MemoryRateRedis();
  await enforceInternalRateLimit({
    redis,
    consumerHash: "consumer",
    route: "/route",
    mutation: true
  });
  await assert.rejects(
    enforceInternalRateLimit({
      redis,
      consumerHash: "consumer",
      route: "/route",
      mutation: true
    }),
    (error: unknown) =>
      error instanceof InternalApiError &&
      error.code === "RATE_LIMITED" &&
      new Headers(error.headers).get("Retry-After") === "10"
  );
  restoreEnv("WA2_INTERNAL_API_RATE_LIMIT", previous);
});

test("falha do Redis fecha mutações e degrada leituras", async () => {
  const redis = new MemoryRateRedis();
  redis.fail = true;
  await assert.rejects(
    enforceInternalRateLimit({
      redis,
      consumerHash: "consumer",
      route: "/route",
      mutation: true
    }),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "DEPENDENCY_UNAVAILABLE"
  );
  const read = await enforceInternalRateLimit({
    redis,
    consumerHash: "consumer",
    route: "/route",
    mutation: false
  });
  assert.equal(read.degraded, true);
});

test("wrapper retorna 401 padronizado sem cookie ou segredo", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  const wrapped = withInternalApi(async () => internalJson({ ok: true }), {
    redis: new MemoryInternalRedis()
  });
  const response = await wrapped(new NextRequest("http://localhost/api/internal/v1/health"));
  const body = (await response.json()) as {
    error: { code: string; message: string; requestId: string };
  };
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "UNAUTHORIZED");
  assert.ok(body.error.requestId);
  assert.equal("stack" in body.error, false);
  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
});

test("wrapper retorna 429 com Retry-After", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  const previousLimit = process.env.WA2_INTERNAL_API_RATE_LIMIT;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  process.env.WA2_INTERNAL_API_RATE_LIMIT = "1";
  const redis = new MemoryInternalRedis();
  const wrapped = withInternalApi(async () => internalJson({ ok: true }), { redis });
  const request = () =>
    new NextRequest("http://localhost/api/internal/v1/health", {
      headers: { authorization: "Bearer configured-secret" }
    });
  assert.equal((await wrapped(request())).status, 200);
  const limited = await wrapped(request());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "10");
  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
  restoreEnv("WA2_INTERNAL_API_RATE_LIMIT", previousLimit);
});

test("wrapper sanitiza erro interno e não expõe segredo ou stack", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  const wrapped = withInternalApi(
    async () => {
      throw new Error("configured-secret SQL /private/session/path");
    },
    { redis: new MemoryInternalRedis() }
  );
  const response = await wrapped(
    new NextRequest("http://localhost/api/internal/v1/health", {
      headers: { authorization: "Bearer configured-secret" }
    })
  );
  const text = await response.text();
  assert.equal(response.status, 500);
  assert.doesNotMatch(text, /configured-secret|SQL|private|stack/i);
  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
});

test("falha ao completar idempotência mantém processing e não repete o handler", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  const redis = new FailingCompletionRedis();
  let executions = 0;
  const wrapped = withInternalApi(
    async () => {
      executions += 1;
      return internalJson({ ok: true }, 202);
    },
    { idempotent: true, redis }
  );
  const request = () =>
    new NextRequest("http://localhost/api/internal/v1/instances", {
      method: "POST",
      headers: {
        authorization: "Bearer configured-secret",
        "idempotency-key": "completion-failure-123"
      },
      body: "{}"
    });

  const first = await wrapped(request());
  assert.equal(first.status, 202);
  assert.equal(first.headers.get("X-Idempotency-Status"), "processing");
  assert.ok(first.headers.get("X-Request-Id"));

  const replay = await wrapped(request());
  assert.equal(replay.status, 409);
  assert.equal(executions, 1);
  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
});

test("handler que lança após efeito mantém processing e não executa novamente", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  const redis = new MemoryInternalRedis();
  let effects = 0;
  const wrapped = withInternalApi(
    async () => {
      effects += 1;
      throw new Error("failure after effect");
    },
    { idempotent: true, redis }
  );
  const request = () =>
    new NextRequest("http://localhost/api/internal/v1/instances", {
      method: "POST",
      headers: {
        authorization: "Bearer configured-secret",
        "idempotency-key": "safe-retry-123"
      },
      body: "{}"
    });

  const first = await wrapped(request());
  assert.equal(first.status, 500);
  assert.ok(first.headers.get("X-Request-Id"));
  assert.doesNotMatch(await first.text(), /failure after effect/);
  assert.equal(redis.values.size, 1);
  assert.equal((await wrapped(request())).status, 409);
  assert.equal(effects, 1);
  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
});

test("falha anterior ao handler não executa efeito nem cria processing inválido", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  const redis = new MemoryInternalRedis();
  let executions = 0;
  const wrapped = withInternalApi(
    async () => {
      executions += 1;
      return internalJson({ ok: true });
    },
    { idempotent: true, redis }
  );

  const response = await wrapped(
    new NextRequest("http://localhost/api/internal/v1/instances", {
      method: "POST",
      headers: {
        "idempotency-key": "pre-handler-failure-123"
      },
      body: "{}"
    })
  );

  assert.equal(response.status, 401);
  assert.equal(executions, 0);
  assert.equal(redis.values.size, 0);
  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
});

test("erro controlado 422 abandona idempotência e permite nova tentativa", async () => {
  const previousSecret = process.env.WA2_INTERNAL_API_SECRET;
  process.env.WA2_INTERNAL_API_SECRET = "configured-secret";
  const redis = new MemoryInternalRedis();
  let executions = 0;

  const wrapped = withInternalApi(
    async () => {
      executions += 1;
      throw new InternalApiError(
        "LID_UNRESOLVED",
        "LID sem telefone resolvido",
        422
      );
    },
    { idempotent: true, redis }
  );

  const request = () =>
    new NextRequest("http://localhost/api/internal/v1/labels", {
      method: "POST",
      headers: {
        authorization: "Bearer configured-secret",
        "idempotency-key": "controlled-error-422"
      },
      body: "{}"
    });

  const first = await wrapped(request());
  assert.equal(first.status, 422);
  assert.equal(redis.values.size, 0);

  const second = await wrapped(request());
  assert.equal(second.status, 422);
  assert.equal(executions, 2);
  assert.equal(redis.values.size, 0);

  restoreEnv("WA2_INTERNAL_API_SECRET", previousSecret);
});
