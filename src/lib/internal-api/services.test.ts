import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { InternalApiError } from "./errors";

const now = new Date("2026-07-27T12:00:00.000Z");
type MockInstance = {
  id: string;
  name: string;
  role: "GENERAL";
  phone: string | null;
  status: "disconnected" | "connecting" | "qr" | "connected" | "error";
  sessionKey: string;
  isDefault: boolean;
  lastConnectedAt: Date | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const baseInstance: MockInstance = {
  id: "instance-1",
  name: "CRM",
  role: "GENERAL",
  phone: null,
  status: "disconnected",
  sessionKey: "must-not-leak",
  isDefault: false,
  lastConnectedAt: null,
  lastSyncAt: null,
  createdAt: now,
  updatedAt: now
};

let instance: typeof baseInstance | null = baseInstance;
let session: Record<string, unknown> | null = null;
let chat: { id: string; jid: string } | null = null;
let chats: Array<{
  id: string;
  jid: string;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  labels: Array<{ label: { waLabelId: string; name: string; color: number } }>;
}> = [];
let crmContacts: Array<{ id: string; name: string; phoneNormalized: string }> = [];
let whatsappContacts: Array<{
  id: string;
  name: string | null;
  pushName: string | null;
  jid: string;
  phone: string | null;
}> = [];
let label: { id: string; waLabelId: string } | null = null;
let chatLabel: { id: string } | null = null;
let queueCalls: Array<{ name: string; data: unknown }> = [];
let connectEnqueueShouldFail = false;
let connectJobResult: { jobId: string | null; deduped: boolean } = {
  jobId: "connect-real-job",
  deduped: false
};
let databaseWrites = 0;

const prismaMock = {
  whatsappInstance: {
    findUnique: async () => instance,
    findMany: async () => (instance ? [instance] : []),
    update: async (options: { data: { status?: MockInstance["status"] } }) => {
      databaseWrites += 1;
      if (instance && options.data.status) {
        instance = { ...instance, status: options.data.status };
      }
      return instance;
    }
  },
  whatsappSession: {
    findFirst: async () => session,
    upsert: async (options: {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }) => {
      databaseWrites += 1;
      session = session
        ? { ...session, ...options.update }
        : { ...options.create };
      return session;
    }
  },
  whatsappLabel: {
    findFirst: async () => label,
    findMany: async () => []
  },
  whatsappChat: {
    findFirst: async () => chat,
    findMany: async () => chats,
  },
  whatsappChatLabel: {
    findUnique: async () => chatLabel,
    findMany: async () => []
  },
  contact: {
    findMany: async () => crmContacts
  },
  whatsappContact: {
    findMany: async () => whatsappContacts,
    findFirst: async () => whatsappContacts[0] ?? null
  },
  $transaction: async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback(prismaMock)
};

const enqueue = (name: string) => async (data: unknown) => {
  queueCalls.push({ name, data });
  return { jobId: `${name}-job`, deduped: false };
};

mock.module("../prisma/client", {
  namedExports: { prisma: prismaMock }
});
mock.module("../queue/campaign-queue", {
  namedExports: {
    enqueueMutateWhatsappChatLabel: enqueue("label"),
    enqueueWhatsappCatalogSync: enqueue("catalog"),
    enqueueWhatsappConnect: async (data: unknown) => {
      queueCalls.push({ name: "connect", data });
      if (connectEnqueueShouldFail) {
        throw new Error("queue unavailable");
      }
      return connectJobResult;
    },
    enqueueWhatsappHistorySync: enqueue("history"),
    enqueueWhatsappPreserveDisconnect: enqueue("preserve-disconnect")
  }
});
mock.module("../server/whatsapp-instances", {
  namedExports: {
    createWhatsappInstance: async () => ({
      instance: baseInstance,
      created: true
    })
  }
});

let services: typeof import("./services");

function reset() {
  instance = { ...baseInstance };
  session = null;
  chat = null;
  chats = [];
  crmContacts = [];
  whatsappContacts = [];
  label = null;
  chatLabel = null;
  queueCalls = [];
  connectEnqueueShouldFail = false;
  connectJobResult = { jobId: "connect-real-job", deduped: false };
  databaseWrites = 0;
}

test.beforeEach(reset);
test.before(async () => {
  services = await import("./services");
});

test("criação sanitiza sessionKey e não enfileira conexão", async () => {
  const result = await services.createInternalInstance("CRM", "GENERAL");
  assert.equal("sessionKey" in result.instance, false);
  assert.equal(queueCalls.length, 0);
});

test("GET QR somente lê o valor persistido e não enfileira", async () => {
  session = {
    qrCode: "data:image/png;base64,AAAA",
    status: "qr",
    updatedAt: new Date()
  };
  const result = await services.getInternalInstanceQr("instance-1");
  assert.match(result.qrCode, /^data:image\//);
  assert.equal(queueCalls.length, 0);
});

test("status converte erro interno em código sanitizado", async () => {
  session = {
    status: "error",
    connectedPhone: null,
    lastError: "detalhe sensível do Baileys",
    qrCode: null,
    updatedAt: now
  };
  const result = await services.getInternalInstanceStatus("instance-1");
  assert.equal(result.lastErrorCode, "WHATSAPP_OPERATION_FAILED");
  assert.equal("lastError" in result, false);
});

test("instância inexistente retorna erro 404", async () => {
  instance = null;
  await assert.rejects(
    services.requireInternalInstance("missing"),
    (error: unknown) =>
      error instanceof InternalApiError &&
      error.code === "INSTANCE_NOT_FOUND" &&
      error.status === 404
  );
});

test("connect somente enfileira e retorna o job real", async () => {
  const result = await services.connectInternalInstance("instance-1", "auto");
  assert.equal(result.enqueued, true);
  assert.equal(result.jobId, "connect-real-job");
  assert.deepEqual(queueCalls.map((call) => call.name), ["connect"]);
  assert.equal(databaseWrites, 0);
});

test("connect deduplicado retorna o job real sem escrita de banco", async () => {
  connectJobResult = { jobId: "existing-connect-job", deduped: true };
  const result = await services.connectInternalInstance("instance-1", "auto");
  assert.equal(result.enqueued, false);
  assert.equal(result.jobId, "existing-connect-job");
  assert.deepEqual(queueCalls.map((call) => call.name), ["connect"]);
  assert.equal(databaseWrites, 0);
});

test("falha ao enfileirar connect não altera banco nem tenta compensação", async () => {
  instance = {
    ...baseInstance,
    status: "disconnected",
    phone: "5511987654321"
  };
  session = {
    id: "instance:instance-1",
    status: "qr",
    qrCode: "data:image/png;base64,PREVIOUS",
    lastError: "erro anterior",
    connectedPhone: "5511987654321"
  };
  connectEnqueueShouldFail = true;

  await assert.rejects(
    services.connectInternalInstance("instance-1", "auto"),
    /queue unavailable/
  );

  assert.equal(instance?.status, "disconnected");
  assert.deepEqual(session, {
    id: "instance:instance-1",
    status: "qr",
    qrCode: "data:image/png;base64,PREVIOUS",
    lastError: "erro anterior",
    connectedPhone: "5511987654321"
  });
  assert.deepEqual(queueCalls.map((call) => call.name), ["connect"]);
  assert.equal(databaseWrites, 0);
});

test("new_qr não substitui sessão confirmada", async () => {
  instance = { ...baseInstance, status: "disconnected", phone: "5511987654321" };
  await assert.rejects(
    services.connectInternalInstance("instance-1", "new_qr"),
    (error: unknown) =>
      error instanceof InternalApiError &&
      error.code === "INSTANCE_STATE_CONFLICT" &&
      error.status === 409
  );
  assert.equal(queueCalls.length, 0);
});

test("sync somente enfileira o escopo solicitado", async () => {
  instance = { ...baseInstance, status: "connected", phone: "5511987654321" };
  await services.syncInternalInstance("instance-1", "history");
  assert.deepEqual(queueCalls.map((call) => call.name), ["history"]);
});

test("disconnect usa exclusivamente o job que preserva sessão", async () => {
  instance = { ...baseInstance, status: "connected", phone: "5511987654321" };
  await services.disconnectInternalInstance("instance-1");
  assert.deepEqual(queueCalls.map((call) => call.name), ["preserve-disconnect"]);
});

test("by-phone resolve telefone E.164 exato em contato e chat", async () => {
  whatsappContacts = [{
    id: "contact-1",
    name: "Contato",
    pushName: null,
    jid: "5538999990000@s.whatsapp.net",
    phone: "5538999990000"
  }];
  chats = [{
    id: "chat-1",
    jid: "5538999990000@s.whatsapp.net",
    lastInboundAt: now,
    lastOutboundAt: null,
    labels: []
  }];
  const result = await services.findInternalContactByPhone(
    "instance-1",
    "5538999990000"
  );
  assert.equal(result.contact.jid, "5538999990000@s.whatsapp.net");
  assert.equal(result.chat?.id, "chat-1");
});

test("by-phone resolve JID c.us e contato somente no catálogo", async () => {
  whatsappContacts = [{
    id: "contact-1",
    name: null,
    pushName: "Contato",
    jid: "5538999990000@c.us",
    phone: null
  }];
  const result = await services.findInternalContactByPhone(
    "instance-1",
    "5538999990000"
  );
  assert.equal(result.contact.jid, "5538999990000@c.us");
  assert.equal(result.chat, null);
});

test("by-phone resolve contato somente no histórico/chat", async () => {
  chats = [{
    id: "chat-1",
    jid: "5538999990000@s.whatsapp.net",
    lastInboundAt: now,
    lastOutboundAt: null,
    labels: []
  }];
  const result = await services.findInternalContactByPhone(
    "instance-1",
    "5538999990000"
  );
  assert.equal(result.contact.id, "chat-1");
  assert.equal(result.chat?.id, "chat-1");
});

test("by-phone usa alias brasileiro somente quando unívoco", async () => {
  whatsappContacts = [{
    id: "contact-1",
    name: "Contato",
    pushName: null,
    jid: "553899990000@s.whatsapp.net",
    phone: "553899990000"
  }];
  const result = await services.findInternalContactByPhone(
    "instance-1",
    "5538999990000"
  );
  assert.equal(result.contact.phoneNormalized, "5538999990000");
  assert.equal(result.contact.jid, "553899990000@s.whatsapp.net");
});

test("by-phone prioriza exato e rejeita aliases múltiplos sem exato", async () => {
  whatsappContacts = [{
    id: "contact-1",
    name: "Exato",
    pushName: null,
    jid: "5538999990000@s.whatsapp.net",
    phone: "5538999990000"
  }, {
    id: "contact-2",
    name: "Alias",
    pushName: null,
    jid: "553899990000@s.whatsapp.net",
    phone: "553899990000"
  }];
  const exact = await services.findInternalContactByPhone(
    "instance-1",
    "5538999990000"
  );
  assert.equal(exact.contact.id, "contact-1");

  whatsappContacts = [{
    id: "contact-2",
    name: "Alias",
    pushName: null,
    jid: "553899990000@s.whatsapp.net",
    phone: "553899990000"
  }, {
    id: "contact-3",
    name: "Alias divergente",
    pushName: null,
    jid: "553899990000@c.us",
    phone: "553899990000"
  }];
  await assert.rejects(
    services.findInternalContactByPhone("instance-1", "5538999990000"),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "CONTACT_AMBIGUOUS"
  );
});

test("by-phone retorna LID_UNRESOLVED sem inventar vínculo", async () => {
  whatsappContacts = [{
    id: "lid-1",
    name: "LID",
    pushName: null,
    jid: "5538999990000@lid",
    phone: null
  }];
  await assert.rejects(
    services.findInternalContactByPhone("instance-1", "5538999990000"),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "LID_UNRESOLVED"
  );
});

test("by-phone retorna CONTACT_NOT_FOUND quando armazenamento não possui candidato", async () => {
  await assert.rejects(
    services.findInternalContactByPhone("instance-1", "5538999990000"),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "CONTACT_NOT_FOUND"
  );
});

test("by-phone resolve LID quando a associação persistida possui telefone", async () => {
  whatsappContacts = [{
    id: "lid-1",
    name: "LID",
    pushName: null,
    jid: "123@lid",
    phone: "5538999990000"
  }];
  chats = [{
    id: "chat-lid",
    jid: "123@lid",
    lastInboundAt: now,
    lastOutboundAt: null,
    labels: []
  }];
  const result = await services.findInternalContactByPhone(
    "instance-1",
    "5538999990000"
  );
  assert.equal(result.contact.jid, "5538999990000@s.whatsapp.net");
  assert.equal(result.chat?.jid, "123@lid");
});

test("aplicação de etiqueta enfileira uma vez e repetição local não duplica", async () => {
  chat = { id: "chat-1", jid: "5511987654321@s.whatsapp.net" };
  label = { id: "label-1", waLabelId: "10" };
  const first = await services.mutateInternalChatLabel({
    instanceId: "instance-1",
    chatId: "chat-1",
    waLabelId: "10",
    operation: "apply",
    correlationKey: "request-123"
  });
  assert.equal(first.enqueued, true);
  assert.equal(
    (queueCalls[0]?.data as { correlationKey?: string }).correlationKey,
    "request-123"
  );
  chatLabel = { id: "association-1" };
  const replay = await services.mutateInternalChatLabel({
    instanceId: "instance-1",
    chatId: "chat-1",
    waLabelId: "10",
    operation: "apply"
  });
  assert.equal(replay.changed, false);
  assert.equal(queueCalls.length, 1);
});

test("remoção repetida de etiqueta ausente é segura", async () => {
  chat = { id: "chat-1", jid: "5511987654321@s.whatsapp.net" };
  label = { id: "label-1", waLabelId: "10" };
  const result = await services.mutateInternalChatLabel({
    instanceId: "instance-1",
    chatId: "chat-1",
    waLabelId: "10",
    operation: "remove"
  });
  assert.equal(result.changed, false);
  assert.equal(queueCalls.length, 0);
});

test("remoção existente é enfileirada sem apagar localmente na rota", async () => {
  chat = { id: "chat-1", jid: "5511987654321@s.whatsapp.net" };
  label = { id: "label-1", waLabelId: "10" };
  chatLabel = { id: "association-1" };
  const result = await services.mutateInternalChatLabel({
    instanceId: "instance-1",
    chatId: "chat-1",
    waLabelId: "10",
    operation: "remove"
  });
  assert.equal(result.enqueued, true);
  assert.deepEqual(queueCalls.map((call) => call.name), ["label"]);
});

test("LID é bloqueado antes de qualquer job", async () => {
  chat = { id: "chat-1", jid: "123@lid" };
  await assert.rejects(
    services.mutateInternalChatLabel({
      instanceId: "instance-1",
      chatId: "chat-1",
      waLabelId: "10",
      operation: "apply"
    }),
    (error: unknown) =>
      error instanceof InternalApiError && error.code === "LID_UNRESOLVED"
  );
  assert.equal(queueCalls.length, 0);
});

test("LID com associação telefônica persistida pode receber etiqueta", async () => {
  chat = { id: "chat-1", jid: "123@lid" };
  label = { id: "label-1", waLabelId: "10" };
  whatsappContacts = [{
    id: "lid-1",
    name: null,
    pushName: null,
    jid: "123@lid",
    phone: "5538999990000"
  }];
  const result = await services.mutateInternalChatLabel({
    instanceId: "instance-1",
    chatId: "chat-1",
    waLabelId: "10",
    operation: "apply"
  });
  assert.equal(result.enqueued, true);
});

test("grupo é bloqueado com 422 antes de qualquer job", async () => {
  chat = { id: "chat-1", jid: "123@g.us" };
  await assert.rejects(
    services.mutateInternalChatLabel({
      instanceId: "instance-1",
      chatId: "chat-1",
      waLabelId: "10",
      operation: "apply"
    }),
    (error: unknown) =>
      error instanceof InternalApiError &&
      error.code === "UNSUPPORTED_JID" &&
      error.status === 422
  );
  assert.equal(queueCalls.length, 0);
});

test("worker continua delegando connect para reconnectWhatsappInstance", async () => {
  const workerSource = await readFile(
    resolve(process.cwd(), "src/worker/sender-worker.ts"),
    "utf8"
  );
  assert.match(
    workerSource,
    /if \(job\.name === CONNECT_WHATSAPP_JOB\)[\s\S]*await reconnectWhatsappInstance\(instanceId\)/
  );
});
