import assert from "node:assert/strict";
import test, { mock } from "node:test";

const existingInstance = {
  id: "instance-1",
  name: "CRM Principal",
  role: "GENERAL",
  phone: null,
  status: "disconnected",
  sessionKey: "crm-principal-existing",
  isDefault: true,
  lastConnectedAt: null,
  lastSyncAt: null,
  createdAt: new Date("2026-07-27T12:00:00.000Z"),
  updatedAt: new Date("2026-07-27T12:00:00.000Z")
};

let findResults: Array<Array<typeof existingInstance>> = [];
let countResults: number[] = [];
let events: string[] = [];
let createCalls = 0;
let transactionCalls = 0;

const whatsappInstanceMock = {
  findMany: async () => {
    events.push("find");
    return findResults.shift() ?? [];
  },
  count: async () => {
    events.push("count");
    return countResults.shift() ?? 1;
  },
  create: async (options: {
    data: {
      name: string;
      role: "GENERAL";
      sessionKey: string;
      isDefault: boolean;
    };
  }) => {
    events.push("create");
    createCalls += 1;
    return {
      ...existingInstance,
      id: `created-${createCalls}`,
      ...options.data
    };
  }
};

const transactionMock = {
  whatsappInstance: whatsappInstanceMock,
  $executeRaw: async () => {
    events.push("lock");
    return 1;
  }
};

const prismaMock = {
  whatsappInstance: whatsappInstanceMock,
  $transaction: async (
    callback: (transaction: typeof transactionMock) => Promise<unknown>
  ) => {
    transactionCalls += 1;
    return callback(transactionMock);
  }
};

mock.module("../prisma/client", {
  namedExports: { prisma: prismaMock }
});
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined })
  }
});

let instances: typeof import("./whatsapp-instances");

test.before(async () => {
  instances = await import("./whatsapp-instances");
});

test.beforeEach(() => {
  findResults = [];
  countResults = [];
  events = [];
  createCalls = 0;
  transactionCalls = 0;
});

test("reuseExisting adquire lock e repete consulta antes de criar", async () => {
  findResults = [[], [existingInstance]];

  const result = await instances.createWhatsappInstance({
    name: "  CRM   Principal ",
    role: "GENERAL",
    reuseExisting: true
  });

  assert.equal(result.created, false);
  assert.equal(result.instance.id, existingInstance.id);
  assert.equal(transactionCalls, 1);
  assert.equal(createCalls, 0);
  assert.deepEqual(events, ["find", "lock", "find"]);
});

test("nome histórico com espaços, caixa e Unicode equivalentes é reutilizado", async () => {
  const historical = {
    ...existingInstance,
    name: "  CRM   PRINCIPAL  "
  };
  findResults = [[historical]];

  const result = await instances.createWhatsappInstance({
    name: "CRM Principal",
    role: "GENERAL",
    reuseExisting: true
  });

  assert.equal(result.created, false);
  assert.equal(result.instance.id, historical.id);
  assert.equal(transactionCalls, 0);
  assert.equal(createCalls, 0);
  assert.deepEqual(events, ["find"]);
});

test("reuseExisting false preserva criação independente sem advisory lock", async () => {
  countResults = [1];

  const result = await instances.createWhatsappInstance({
    name: "CRM Principal",
    role: "GENERAL",
    reuseExisting: false
  });

  assert.equal(result.created, true);
  assert.equal(transactionCalls, 0);
  assert.equal(createCalls, 1);
  assert.deepEqual(events, ["count", "create"]);
});

test("seleção da primeira default repete contagem sob trava dedicada", async () => {
  findResults = [[], []];
  countResults = [0, 1];

  const result = await instances.createWhatsappInstance({
    name: "Nova instância",
    role: "GENERAL",
    reuseExisting: true
  });

  assert.equal(result.created, true);
  assert.equal(result.instance.isDefault, false);
  assert.equal(events.filter((event) => event === "lock").length, 2);
  assert.deepEqual(events, ["find", "lock", "find", "count", "lock", "count", "create"]);
});
