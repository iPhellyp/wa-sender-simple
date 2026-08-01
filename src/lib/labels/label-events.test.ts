import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

let queryRows: Array<Record<string, unknown>> = [];
let lastQuery: { strings: readonly string[]; values: readonly unknown[] } | null = null;

const prismaMock = {
  whatsappContact: {
    findUnique: async () => null
  },
  whatsappChat: {
    upsert: async () => ({ id: "chat-1" })
  },
  $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback({ $executeRaw: async () => 1 }),
  $queryRaw: async (query: { strings: readonly string[]; values: readonly unknown[] }) => {
    lastQuery = query;
    return queryRows;
  }
};

mock.module("../prisma/client", {
  namedExports: { prisma: prismaMock }
});

let labelEvents: typeof import("./label-events");

test.before(async () => {
  labelEvents = await import("./label-events");
});

function fakeTransaction(results: number[]) {
  const queries: Array<{ strings: readonly string[]; values: readonly unknown[] }> = [];
  return {
    queries,
    transaction: {
      $executeRaw: async (query: {
        strings: readonly string[];
        values: readonly unknown[];
      }) => {
        queries.push(query);
        return results.shift() ?? 0;
      },
      $queryRaw: async () => [{ waLabelId: "10", name: "FEZ PROVA" }]
    }
  };
}

test("aplicação manual gera evento WHATSAPP somente quando a associação muda", async () => {
  const fake = fakeTransaction([1, 1, 1]);
  const result = await labelEvents.persistLabelAssociationChange(fake.transaction, {
    instanceId: "instance-1",
    chatId: "chat-1",
    labelId: "label-1",
    waLabelId: "10",
    jid: "5511987654321@s.whatsapp.net",
    operation: "APPLY",
    source: "WHATSAPP"
  });

  assert.equal(result.changed, true);
  assert.equal(fake.queries.length, 3);
  assert.ok(fake.queries[1]?.values.includes("WHATSAPP"));
  assert.ok(fake.queries[1]?.values.includes("APPLY"));
});

test("remoção manual gera REMOVE e repetição sem alteração é deduplicada", async () => {
  const removal = fakeTransaction([1, 1]);
  const changed = await labelEvents.persistLabelAssociationChange(removal.transaction, {
    instanceId: "instance-1",
    chatId: "chat-1",
    labelId: "label-1",
    waLabelId: "10",
    jid: "5511987654321@s.whatsapp.net",
    operation: "REMOVE",
    source: "WHATSAPP"
  });
  assert.equal(changed.changed, true);
  assert.ok(removal.queries[1]?.values.includes("REMOVE"));

  const duplicate = fakeTransaction([0]);
  const unchanged = await labelEvents.persistLabelAssociationChange(duplicate.transaction, {
    instanceId: "instance-1",
    chatId: "chat-1",
    labelId: "label-1",
    waLabelId: "10",
    jid: "5511987654321@s.whatsapp.net",
    operation: "REMOVE",
    source: "WHATSAPP"
  });
  assert.deepEqual(unchanged, { changed: false, eventId: null });
  assert.equal(duplicate.queries.length, 1);
});

test("alteração da API interna preserva source, correlação e instância", async () => {
  const fake = fakeTransaction([1, 1]);
  await labelEvents.persistLabelAssociationChange(fake.transaction, {
    instanceId: "instance-2",
    chatId: "chat-2",
    labelId: "label-2",
    waLabelId: "20",
    jid: "5511976543210@s.whatsapp.net",
    operation: "APPLY",
    source: "INTERNAL_API",
    correlationKey: "request-123"
  });

  const values = fake.queries[1]?.values ?? [];
  assert.ok(values.includes("instance-2"));
  assert.ok(values.includes("INTERNAL_API"));
  assert.ok(values.includes("request-123"));
});

test("classifica contato, LID, grupo e broadcast para automação do CRM", () => {
  assert.deepEqual(
    labelEvents.classifyLabelEventTarget("5511987654321@s.whatsapp.net"),
    {
      phoneNormalized: "5511987654321",
      eligibleForCrm: true,
      ineligibleReason: null
    }
  );
  assert.equal(
    labelEvents.classifyLabelEventTarget("123@lid").ineligibleReason,
    "LID_UNRESOLVED"
  );
  assert.equal(
    labelEvents.classifyLabelEventTarget("123@lid", "5511987654321").eligibleForCrm,
    true
  );
  assert.equal(
    labelEvents.classifyLabelEventTarget("123@g.us").ineligibleReason,
    "GROUP"
  );
  assert.equal(
    labelEvents.classifyLabelEventTarget("status@broadcast").ineligibleReason,
    "BROADCAST"
  );
});

test("cursor opaco pagina, retoma e mantém ordenação estável por id", async () => {
  queryRows = [
    {
      id: BigInt(11),
      eventId: "00000000-0000-4000-8000-000000000011",
      instanceId: "instance-1",
      chatId: "chat-1",
      jid: "5511987654321@s.whatsapp.net",
      phoneNormalized: "5511987654321",
      waLabelId: "10",
      operation: "APPLY",
      source: "WHATSAPP",
      observedAt: new Date("2026-07-27T12:00:00.000Z"),
      eligibleForCrm: true,
      ineligibleReason: null
    },
    {
      id: BigInt(12),
      eventId: "00000000-0000-4000-8000-000000000012",
      instanceId: "instance-2",
      chatId: "chat-2",
      jid: "123@g.us",
      phoneNormalized: null,
      waLabelId: "20",
      operation: "REMOVE",
      source: "WHATSAPP",
      observedAt: new Date("2026-07-27T12:01:00.000Z"),
      eligibleForCrm: false,
      ineligibleReason: "GROUP"
    },
    {
      id: BigInt(13),
      eventId: "00000000-0000-4000-8000-000000000013",
      instanceId: "instance-1",
      chatId: "chat-3",
      jid: "5511911111111@s.whatsapp.net",
      phoneNormalized: "5511911111111",
      waLabelId: "30",
      operation: "APPLY",
      source: "INTERNAL_API",
      observedAt: new Date("2026-07-27T12:02:00.000Z"),
      eligibleForCrm: true,
      ineligibleReason: null
    }
  ];

  const first = await labelEvents.listLabelEvents(
    new URLSearchParams({ limit: "2" })
  );
  assert.equal(first.events.length, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.events[0]?.instanceId, "instance-1");
  assert.equal(first.events[1]?.instanceId, "instance-2");
  assert.equal("id" in first.events[0]!, false);
  assert.equal("correlationKey" in first.events[0]!, false);
  assert.match(lastQuery?.strings.join(" ") ?? "", /ORDER BY "id" ASC/);

  queryRows = [];
  const resumed = await labelEvents.listLabelEvents(
    new URLSearchParams({ after: first.nextCursor!, limit: "2" })
  );
  assert.equal(resumed.nextCursor, first.nextCursor);
  assert.ok(lastQuery?.values.includes(BigInt(12)));
});

test("resposta e migration não armazenam ou expõem conteúdo sensível", async () => {
  const migration = await readFile(
    resolve(
      process.cwd(),
      "prisma/migrations/20260727150000_whatsapp_label_event_outbox/migration.sql"
    ),
    "utf8"
  );
  const route = await readFile(
    resolve(process.cwd(), "app/api/internal/v1/label-events/route.ts"),
    "utf8"
  );

  assert.doesNotMatch(migration, /\b(message|media|qr|token|session)\b/i);
  assert.doesNotMatch(migration, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im);
  assert.match(migration, /CREATE TABLE "WhatsappLabelEvent"/);
  assert.match(migration, /UNIQUE INDEX "WhatsappLabelEvent_eventId_key"/);
  assert.match(route, /withInternalApi/);
});
