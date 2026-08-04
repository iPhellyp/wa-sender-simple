import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { WAMessage } from "@whiskeysockets/baileys";

type StoredChat = {
  id: string;
  name: string | null;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  isGroup: boolean;
  lastMessageText?: string | null;
};

const contacts = new Map<string, { name: string | null; pushName: string | null }>();
const chats = new Map<string, StoredChat>();
const messages = new Map<string, Record<string, unknown>>();

function chatKey(instanceId: string, jid: string) {
  return `${instanceId}:${jid}`;
}

function messageKey(instanceId: string, jid: string, waMessageId: string) {
  return `${instanceId}:${jid}:${waMessageId}`;
}

function resetStore() {
  contacts.clear();
  chats.clear();
  messages.clear();
}

mock.module("../prisma/client", {
  namedExports: {
    prisma: {
      whatsappContact: {
        findUnique: async ({ where }: { where: { instanceId_jid: { instanceId: string; jid: string } } }) =>
          contacts.get(chatKey(where.instanceId_jid.instanceId, where.instanceId_jid.jid)) ?? null,
        upsert: async ({
          where,
          create,
          update
        }: {
          where: { instanceId_jid: { instanceId: string; jid: string } };
          create: { name?: string | null; pushName?: string | null };
          update: { name?: string | null; pushName?: string | null };
        }) => {
          const key = chatKey(where.instanceId_jid.instanceId, where.instanceId_jid.jid);
          const current = contacts.get(key) ?? { name: null, pushName: null };
          const next = { ...current, ...update };
          contacts.set(key, next);
          return next;
        }
      },
      whatsappChat: {
        findUnique: async ({ where }: { where: { instanceId_jid: { instanceId: string; jid: string } } }) =>
          chats.get(chatKey(where.instanceId_jid.instanceId, where.instanceId_jid.jid)) ?? null,
        upsert: async ({
          where,
          create,
          update
        }: {
          where: { instanceId_jid: { instanceId: string; jid: string } };
          create: {
            instanceId: string;
            jid: string;
            name?: string | null;
            isGroup: boolean;
            lastMessageAt?: Date | null;
            lastInboundAt?: Date | null;
            lastOutboundAt?: Date | null;
            lastMessageText?: string | null;
          };
          update: Partial<StoredChat>;
        }) => {
          const key = chatKey(where.instanceId_jid.instanceId, where.instanceId_jid.jid);
          const current = chats.get(key);
          const next: StoredChat = current
            ? { ...current, ...update }
            : {
                id: `chat-${chats.size + 1}`,
                name: null,
                lastMessageAt: null,
                lastInboundAt: null,
                lastOutboundAt: null,
                ...create
              };
          chats.set(key, next);
          return next;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<StoredChat> }) => {
          const current = [...chats.values()].find((chat) => chat.id === where.id);
          assert.ok(current);
          Object.assign(current, data);
          return current;
        }
      },
      whatsappMessage: {
        upsert: async ({
          where,
          create,
          update
        }: {
          where: { instanceId_jid_waMessageId: { instanceId: string; jid: string; waMessageId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = messageKey(
            where.instanceId_jid_waMessageId.instanceId,
            where.instanceId_jid_waMessageId.jid,
            where.instanceId_jid_waMessageId.waMessageId
          );
          const next = { ...(messages.get(key) ?? create), ...update };
          messages.set(key, next);
          return next;
        }
      },
      whatsappIdentity: {
        findUnique: async () => null,
        upsert: async () => ({})
      }
    }
  }
});

mock.module("../server/whatsapp-instances", {
  namedExports: { DEFAULT_WHATSAPP_INSTANCE_ID: "instance-default" }
});

mock.module("../whatsapp/display-name", {
  namedExports: {
    cleanDisplayName: (value: string | null | undefined) => value?.trim() || null,
    isBetterDisplayName: (current: string | null | undefined, candidate: string | null | undefined) =>
      !current && Boolean(candidate),
    pickBestDisplayName: (
      current: string | null | undefined,
      candidates: Array<string | null | undefined>
    ) => current ?? candidates.find(Boolean) ?? null
  }
});

mock.module("../whatsapp/jid", {
  namedExports: {
    FAST_LABEL_SENDER_MODE: true,
    isBroadcastOrNewsletterJid: () => false,
    isGroupJid: (jid: string) => jid.endsWith("@g.us"),
    recordX1GroupSkips: () => undefined,
    shouldIgnoreJidForX1Only: () => false
  }
});

mock.module("./opt-out", {
  namedExports: { extractMessageText: () => null }
});

mock.module("./identity-map", {
  namedExports: { persistIdentityPairs: async () => ({ observed: 0, created: 0, unchanged: 0, ambiguous: 0, ignored: 0 }) }
});

let sync: typeof import("./sync");

test.before(async () => {
  sync = await import("./sync");
});

test.beforeEach(() => {
  resetStore();
});

function inboundMessage(jid: string, id: string, text = "mensagem recebida"): WAMessage {
  return {
    key: { remoteJid: jid, id, fromMe: false },
    messageTimestamp: 1_754_000_000,
    pushName: "Matheus PH",
    message: { conversation: text }
  };
}

test("modo FAST persiste mensagem inbound live e mantém idempotência", async () => {
  const message = inboundMessage("5511999990000@s.whatsapp.net", "live-1");

  await sync.syncMessagesUpsert({ type: "notify", messages: [message] }, "instance-1");
  await sync.syncMessagesUpsert({ type: "notify", messages: [message] }, "instance-1");

  assert.equal(messages.size, 1);
  assert.equal(messages.values().next().value?.fromMe, false);
});

test("modo FAST mantém histórico sem backfill de mensagens", async () => {
  await sync.syncMessagingHistorySet(
    {
      chats: [],
      contacts: [],
      messages: [inboundMessage("5511999990000@s.whatsapp.net", "history-1")]
    },
    "instance-1"
  );

  assert.equal(messages.size, 0);
});

test("mensagem histórica sem JID ou ID continua ignorada", async () => {
  const missingId = inboundMessage("5511999990000@s.whatsapp.net", "");
  const missingJid = inboundMessage("5511999990000@s.whatsapp.net", "invalid-jid");
  missingJid.key.remoteJid = null;

  await sync.syncMessagingHistorySet(
    { chats: [], contacts: [], messages: [missingId, missingJid] },
    "instance-1"
  );

  assert.equal(messages.size, 0);
});

test("JIDs distintos com o mesmo sufixo permanecem mensagens independentes", async () => {
  await sync.syncMessagesUpsert(
    {
      type: "notify",
      messages: [
        inboundMessage("55111115846@s.whatsapp.net", "matheus-1"),
        inboundMessage("55222225846@s.whatsapp.net", "outro-1")
      ]
    },
    "instance-1"
  );

  assert.equal(messages.size, 2);
});
