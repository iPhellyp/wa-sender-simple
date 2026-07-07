import type {
  BaileysEventMap,
  Chat,
  Contact,
  WAMessage,
  WAMessageUpdate
} from "@whiskeysockets/baileys";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";
import { cleanDisplayName, isBetterDisplayName } from "../whatsapp/display-name";
import {
  FAST_LABEL_SENDER_MODE,
  isBroadcastOrNewsletterJid,
  isGroupJid,
  recordX1GroupSkips,
  shouldIgnoreJidForX1Only
} from "../whatsapp/jid";
import { extractMessageText as extractOptOutMessageText } from "./opt-out";

const BATCH_SIZE = 25;

type BatchResult = {
  processed: number;
  skipped: number;
  failed: number;
  firstError: string | null;
};

type TimestampInput = number | string | Date | null | undefined | {
  toNumber?: () => number;
  toString?: () => string;
};

type MessageSyncOptions = {
  log?: boolean;
  logScope?: "history" | "live";
};

function sanitizeSyncError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Erro desconhecido";
}

function compactText(text: string | null | undefined) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeLogMessageId(messageId: string) {
  return messageId.length > 12 ? `${messageId.slice(0, 8)}...` : messageId;
}

const hiddenMessageTypes = new Set([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo"
]);

const mediaMessageLabels: Record<string, string> = {
  imageMessage: "Imagem recebida",
  videoMessage: "Video recebido",
  audioMessage: "Audio recebido",
  documentMessage: "Documento recebido",
  stickerMessage: "Figurinha recebida",
  contactMessage: "Contato recebido",
  contactsArrayMessage: "Contatos recebidos",
  locationMessage: "Localizacao recebida"
};

function getVisibleMessageText(text: string | null, messageType: string | null) {
  if (text) {
    return text;
  }

  if (!messageType) {
    return null;
  }

  return mediaMessageLabels[messageType] ?? null;
}

function getMessageSkipReason(messageType: string | null, text: string | null) {
  if (!messageType) {
    return "empty-message";
  }

  if (hiddenMessageTypes.has(messageType)) {
    return "technical-message";
  }

  if (messageType === "reactionMessage" && !text) {
    return "empty-reaction";
  }

  if (!getVisibleMessageText(text, messageType)) {
    return "empty-message";
  }

  return null;
}

function isIgnoredJid(jid: string | null | undefined) {
  return isBroadcastOrNewsletterJid(jid);
}

export function normalizeChatJid(jid: string | null | undefined) {
  const trimmed = jid?.trim();

  if (!trimmed || isIgnoredJid(trimmed)) {
    return null;
  }

  const atIndex = trimmed.lastIndexOf("@");

  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return null;
  }

  const local = trimmed.slice(0, atIndex).split(":")[0];
  const server = trimmed.slice(atIndex + 1);

  if (!local || !server) {
    return null;
  }

  const normalizedJid = `${local}@${server}`.toLowerCase();

  return isIgnoredJid(normalizedJid) ? null : normalizedJid;
}

export { isGroupJid };

export async function ensureChatForJid(jid: string, optionalName?: string | null) {
  const normalizedJid = normalizeChatJid(jid);

  if (!normalizedJid) {
    throw new Error("JID de conversa invalido");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("JID ignorado pelo modo X1");
  }

  const name = cleanDisplayName(optionalName, normalizedJid);
  const existingChat = await prisma.whatsappChat.findUnique({
    where: {
      jid: normalizedJid
    },
    select: {
      name: true
    }
  });
  const shouldUpdateName = isBetterDisplayName(existingChat?.name, name, normalizedJid);

  return prisma.whatsappChat.upsert({
    where: {
      jid: normalizedJid
    },
    update: {
      ...(shouldUpdateName ? { name } : {}),
      isGroup: isGroupJid(normalizedJid)
    },
    create: {
      jid: normalizedJid,
      name,
      isGroup: isGroupJid(normalizedJid)
    }
  });
}

function extractPhoneFromJid(jid: string) {
  if (!jid.endsWith("@s.whatsapp.net")) {
    return null;
  }

  const phone = jid.split("@")[0];
  return /^\d+$/.test(phone) ? phone : null;
}

function toNumber(value: TimestampInput) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object") {
    if (typeof value.toNumber === "function") {
      const parsed = value.toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (typeof value.toString === "function") {
      const parsed = Number(value.toString());
      return Number.isFinite(parsed) ? parsed : null;
    }
  }

  return null;
}

export function getMessageTimestamp(messageTimestamp: TimestampInput) {
  const numericTimestamp = toNumber(messageTimestamp);

  if (!numericTimestamp || numericTimestamp <= 0) {
    return null;
  }

  const milliseconds = numericTimestamp > 10_000_000_000
    ? numericTimestamp
    : numericTimestamp * 1000;

  return new Date(milliseconds);
}

function unwrapMessageContent(message: WAMessage["message"] | null | undefined) {
  let current = message ?? null;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const next =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message ??
      current.groupMentionedMessage?.message ??
      current.pollCreationMessageV4?.message ??
      current.pollCreationMessageV5?.message ??
      null;

    if (!next) {
      break;
    }

    current = next;
  }

  return current;
}

export function extractMessageText(message: WAMessage["message"] | null | undefined) {
  const content = unwrapMessageContent(message);

  return compactText(
    extractOptOutMessageText(content) ??
      content?.buttonsResponseMessage?.selectedDisplayText ??
      content?.templateButtonReplyMessage?.selectedDisplayText ??
      content?.listResponseMessage?.title ??
      content?.listResponseMessage?.description ??
      content?.reactionMessage?.text ??
      content?.pollCreationMessage?.name ??
      content?.pollCreationMessageV2?.name ??
      content?.pollCreationMessageV3?.name ??
      content?.imageMessage?.caption ??
      content?.videoMessage?.caption ??
      content?.documentMessage?.caption ??
      content?.contactMessage?.displayName ??
      content?.contactsArrayMessage?.displayName ??
      content?.locationMessage?.name ??
      content?.locationMessage?.address ??
      null
  );
}

export function extractMessageType(message: WAMessage["message"] | null | undefined) {
  const content = unwrapMessageContent(message);

  if (!content) {
    return null;
  }

  const entry = Object.entries(content).find(([key, value]) => {
    return key !== "messageContextInfo" && value !== null && value !== undefined;
  });

  return entry?.[0] ?? null;
}

function getMessageLogNamespace(options: MessageSyncOptions) {
  return options.logScope === "history" ? "[history]" : "[sync]";
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  try {
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (typeof nestedValue === "bigint") {
        return nestedValue.toString();
      }

      if (nestedValue instanceof Uint8Array) {
        return Buffer.from(nestedValue).toString("base64");
      }

      return nestedValue;
    });

    if (!serialized) {
      return Prisma.JsonNull;
    }

    return JSON.parse(serialized) as Prisma.InputJsonValue;
  } catch {
    return Prisma.JsonNull;
  }
}

async function settleInBatches<T>(
  items: T[],
  handler: (item: T) => Promise<boolean>
): Promise<BatchResult> {
  const result: BatchResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
    firstError: null
  };

  for (let index = 0; index < items.length; index += BATCH_SIZE) {
    const batch = items.slice(index, index + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((item) => handler(item)));

    for (const itemResult of settled) {
      if (itemResult.status === "fulfilled") {
        if (itemResult.value) {
          result.processed += 1;
        } else {
          result.skipped += 1;
        }
      } else {
        result.failed += 1;
        result.firstError ??= sanitizeSyncError(itemResult.reason);
      }
    }
  }

  return result;
}

function logSyncResult(
  scope: string,
  counts: Record<string, number | string | null | undefined>,
  result: BatchResult
) {
  console.log(`[sync] ${scope}`, {
    ...counts,
    processed: result.processed,
    skipped: result.skipped,
    failed: result.failed,
    ...(result.firstError ? { firstError: result.firstError } : {})
  });
}

function getBaileysChatJid(chat: Partial<Chat>) {
  return normalizeChatJid(chat.id ?? chat.newJid ?? chat.oldJid);
}

function getBaileysMessageJid(message: WAMessage | WAMessageUpdate) {
  return normalizeChatJid(message.key.remoteJid);
}

function splitX1Chats<T extends Partial<Chat>>(chats: T[]) {
  const allowed: T[] = [];
  let groupSkipped = 0;

  for (const chat of chats) {
    const jid = getBaileysChatJid(chat);

    if (jid && shouldIgnoreJidForX1Only(jid)) {
      groupSkipped += 1;
      continue;
    }

    allowed.push(chat);
  }

  return { allowed, groupSkipped };
}

function splitX1Messages<T extends WAMessage | WAMessageUpdate>(messages: T[]) {
  const allowed: T[] = [];
  let groupSkipped = 0;

  for (const message of messages) {
    const jid = getBaileysMessageJid(message);

    if (jid && shouldIgnoreJidForX1Only(jid)) {
      groupSkipped += 1;
      continue;
    }

    allowed.push(message);
  }

  return { allowed, groupSkipped };
}

export async function upsertChatFromBaileys(chat: Partial<Chat>) {
  const jid = normalizeChatJid(chat.id ?? chat.newJid ?? chat.oldJid);

  if (!jid) {
    return false;
  }

  if (shouldIgnoreJidForX1Only(jid)) {
    if (isGroupJid(jid)) {
      recordX1GroupSkips("chats");
    }
    return false;
  }

  const name = cleanDisplayName(chat.name, jid);
  const unreadCount = typeof chat.unreadCount === "number" ? chat.unreadCount : undefined;
  const lastMessageAt =
    getMessageTimestamp(chat.conversationTimestamp) ??
    getMessageTimestamp(chat.lastMsgTimestamp) ??
    getMessageTimestamp(chat.lastMessageRecvTimestamp);
  const existingChat = await prisma.whatsappChat.findUnique({
    where: {
      jid
    },
    select: {
      name: true,
      lastMessageAt: true
    }
  });
  const shouldUpdateName = isBetterDisplayName(existingChat?.name, name, jid);
  const shouldUpdateLastMessageAt = Boolean(
    lastMessageAt && (!existingChat?.lastMessageAt || lastMessageAt >= existingChat.lastMessageAt)
  );

  await prisma.whatsappChat.upsert({
    where: {
      jid
    },
    update: {
      ...(shouldUpdateName ? { name } : {}),
      isGroup: isGroupJid(jid),
      ...(unreadCount !== undefined ? { unreadCount } : {}),
      ...(shouldUpdateLastMessageAt ? { lastMessageAt } : {})
    },
    create: {
      jid,
      name,
      isGroup: isGroupJid(jid),
      unreadCount: unreadCount ?? 0,
      lastMessageAt
    }
  });

  return true;
}

export async function upsertContactFromBaileys(contact: Partial<Contact>) {
  const jid = normalizeChatJid(contact.jid ?? contact.id ?? contact.lid);

  if (!jid) {
    return false;
  }

  if (shouldIgnoreJidForX1Only(jid)) {
    if (isGroupJid(jid)) {
      recordX1GroupSkips("contacts");
    }
    return false;
  }

  const name = cleanDisplayName(contact.name ?? contact.verifiedName ?? contact.notify, jid);
  const pushName = cleanDisplayName(contact.notify, jid);

  await prisma.whatsappContact.upsert({
    where: {
      jid
    },
    update: {
      phone: extractPhoneFromJid(jid),
      ...(name ? { name } : {}),
      ...(pushName ? { pushName } : {}),
      ...(contact.verifiedName !== undefined ? { isBusiness: Boolean(contact.verifiedName) } : {})
    },
    create: {
      jid,
      phone: extractPhoneFromJid(jid),
      name,
      pushName,
      isBusiness: Boolean(contact.verifiedName)
    }
  });

  if (!isGroupJid(jid)) {
    await ensureChatForJid(jid, name ?? pushName);
  }

  return true;
}

async function upsertContactFromMessage(options: {
  chatJid: string;
  fromMe: boolean;
  pushName?: string | null;
  senderJid?: string | null;
}) {
  const contactJid = isGroupJid(options.chatJid)
    ? normalizeChatJid(options.senderJid)
    : options.chatJid;

  if (!contactJid || isGroupJid(contactJid)) {
    return;
  }

  const candidateName = options.fromMe ? null : cleanDisplayName(options.pushName, contactJid);
  const existingContact = await prisma.whatsappContact.findUnique({
    where: {
      jid: contactJid
    },
    select: {
      name: true,
      pushName: true
    }
  });
  const shouldUpdateName = isBetterDisplayName(existingContact?.name, candidateName, contactJid);
  const shouldUpdatePushName = isBetterDisplayName(
    existingContact?.pushName,
    candidateName,
    contactJid
  );

  await prisma.whatsappContact.upsert({
    where: {
      jid: contactJid
    },
    update: {
      phone: extractPhoneFromJid(contactJid),
      ...(shouldUpdateName ? { name: candidateName } : {}),
      ...(shouldUpdatePushName ? { pushName: candidateName } : {})
    },
    create: {
      jid: contactJid,
      phone: extractPhoneFromJid(contactJid),
      name: candidateName,
      pushName: candidateName,
      isBusiness: false
    }
  });
}

export async function upsertMessageFromBaileys(
  message: WAMessage,
  options: MessageSyncOptions = {}
) {
  const jid = normalizeChatJid(message.key.remoteJid);
  const waMessageId = compactText(message.key.id);

  if (!jid || !waMessageId) {
    if (options.log) {
      console.log(`${getMessageLogNamespace(options)} message skipped`, {
        reason: "missing-jid-or-message-id",
        messageType: null
      });
    }

    return false;
  }

  if (shouldIgnoreJidForX1Only(jid)) {
    if (isGroupJid(jid)) {
      recordX1GroupSkips("messages");
    }

    return false;
  }

  const fromMe = message.key.fromMe === true;
  const senderJid = normalizeChatJid(message.key.participant ?? message.participant);
  const pushName = cleanDisplayName(message.pushName, jid);

  if (FAST_LABEL_SENDER_MODE) {
    await upsertContactFromMessage({
      chatJid: jid,
      fromMe,
      pushName: message.pushName,
      senderJid
    });
    await ensureChatForJid(jid, fromMe ? null : pushName);

    return false;
  }

  const timestamp = getMessageTimestamp(message.messageTimestamp);
  const messageType = extractMessageType(message.message);
  const text = extractMessageText(message.message);
  const skipReason = getMessageSkipReason(messageType, text);

  if (skipReason) {
    if (options.log) {
      console.log(`${getMessageLogNamespace(options)} message skipped`, {
        reason: skipReason,
        messageType,
        messageId: safeLogMessageId(waMessageId)
      });
    }

    return false;
  }

  const lastMessageText = getVisibleMessageText(text, messageType);
  const rawJson = toPrismaJson(message);
  const existingChat = await prisma.whatsappChat.findUnique({
    where: {
      jid
    },
    select: {
      name: true
    }
  });
  const shouldUpdateName = !isGroupJid(jid) && isBetterDisplayName(existingChat?.name, pushName, jid);

  await upsertContactFromMessage({
    chatJid: jid,
    fromMe,
    pushName: message.pushName,
    senderJid
  });

  const chat = await prisma.whatsappChat.upsert({
    where: {
      jid
    },
    update: {
      isGroup: isGroupJid(jid),
      ...(shouldUpdateName ? { name: pushName } : {})
    },
    create: {
      jid,
      ...(!isGroupJid(jid) && pushName ? { name: pushName } : {}),
      isGroup: isGroupJid(jid),
      lastMessageAt: timestamp,
      lastMessageText,
      ...(fromMe ? { lastOutboundAt: timestamp } : { lastInboundAt: timestamp })
    }
  });

  await prisma.whatsappMessage.upsert({
    where: {
      jid_waMessageId: {
        jid,
        waMessageId
      }
    },
    update: {
      chatId: chat.id,
      fromMe,
      senderJid,
      messageType,
      text,
      rawJson,
      ...(timestamp ? { timestamp } : {})
    },
    create: {
      chatId: chat.id,
      waMessageId,
      jid,
      fromMe,
      senderJid,
      timestamp,
      messageType,
      text,
      rawJson
    }
  });

  if (timestamp) {
    const shouldUpdateLastMessage = !chat.lastMessageAt || timestamp >= chat.lastMessageAt;
    const shouldUpdateLastInbound = !fromMe && (!chat.lastInboundAt || timestamp >= chat.lastInboundAt);
    const shouldUpdateLastOutbound = fromMe && (!chat.lastOutboundAt || timestamp >= chat.lastOutboundAt);

    if (shouldUpdateLastMessage || shouldUpdateLastInbound || shouldUpdateLastOutbound) {
      await prisma.whatsappChat.update({
        where: {
          id: chat.id
        },
        data: {
          ...(shouldUpdateLastMessage
            ? {
                lastMessageAt: timestamp,
                lastMessageText
              }
            : {}),
          ...(shouldUpdateLastInbound ? { lastInboundAt: timestamp } : {}),
          ...(shouldUpdateLastOutbound ? { lastOutboundAt: timestamp } : {})
        }
      });
    }
  }

  if (options.log) {
    console.log(`${getMessageLogNamespace(options)} message persisted`, {
      jid,
      messageId: safeLogMessageId(waMessageId),
      fromMe,
      messageType
    });
  }

  return true;
}

export async function updateMessageFromBaileys(messageUpdate: WAMessageUpdate) {
  const jid = normalizeChatJid(messageUpdate.key.remoteJid);
  const waMessageId = compactText(messageUpdate.key.id);

  if (!jid || !waMessageId) {
    return false;
  }

  if (shouldIgnoreJidForX1Only(jid)) {
    return false;
  }

  const timestamp = getMessageTimestamp(messageUpdate.update.messageTimestamp);
  const messageType = extractMessageType(messageUpdate.update.message);
  const text = extractMessageText(messageUpdate.update.message);

  const result = await prisma.whatsappMessage.updateMany({
    where: {
      jid,
      waMessageId
    },
    data: {
      rawJson: toPrismaJson({
        key: messageUpdate.key,
        update: messageUpdate.update
      }),
      ...(timestamp ? { timestamp } : {}),
      ...(messageType ? { messageType } : {}),
      ...(text ? { text } : {})
    }
  });

  return result.count > 0;
}

export async function syncMessagingHistorySet(event: BaileysEventMap["messaging-history.set"]) {
  const syncType = event.syncType ?? null;
  const progress = (event as { progress?: number | null }).progress ?? null;
  const x1Chats = splitX1Chats(event.chats);
  const x1Messages = splitX1Messages(event.messages);

  console.log("[history] messaging-history.set received", {
    syncType,
    progress,
    chats: event.chats.length,
    contacts: event.contacts.length,
    messages: event.messages.length
  });

  if (x1Chats.groupSkipped > 0) {
    recordX1GroupSkips("chats", x1Chats.groupSkipped);
  }

  if (x1Messages.groupSkipped > 0) {
    recordX1GroupSkips("messages", x1Messages.groupSkipped);
  }

  const chatsResult = await settleInBatches(x1Chats.allowed, upsertChatFromBaileys);
  console.log("[history] chats persisted", {
    syncType,
    count: chatsResult.processed,
    skipped: chatsResult.skipped,
    failed: chatsResult.failed,
    ...(chatsResult.firstError ? { firstError: chatsResult.firstError } : {})
  });

  const contactsResult = await settleInBatches(event.contacts, upsertContactFromBaileys);
  console.log("[history] contacts persisted", {
    syncType,
    count: contactsResult.processed,
    skipped: contactsResult.skipped,
    failed: contactsResult.failed,
    ...(contactsResult.firstError ? { firstError: contactsResult.firstError } : {})
  });

  const messagesResult = await settleInBatches(x1Messages.allowed, (message) =>
    upsertMessageFromBaileys(message, { log: true, logScope: "history" })
  );
  console.log("[history] messages persisted", {
    syncType,
    count: messagesResult.processed,
    skipped: messagesResult.skipped,
    failed: messagesResult.failed,
    ...(messagesResult.firstError ? { firstError: messagesResult.firstError } : {})
  });

  console.log("[sync] history set", {
    syncType: event.syncType ?? null,
    chats: event.chats.length,
    contacts: event.contacts.length,
    messages: event.messages.length
  });
}

export async function syncChatsUpsert(chats: BaileysEventMap["chats.upsert"]) {
  const x1Chats = splitX1Chats(chats);

  if (x1Chats.groupSkipped > 0) {
    recordX1GroupSkips("chats", x1Chats.groupSkipped);
  }

  logSyncResult(
    "chats upsert",
    { chats: chats.length },
    await settleInBatches(x1Chats.allowed, upsertChatFromBaileys)
  );
}

export async function syncChatsUpdate(chats: BaileysEventMap["chats.update"]) {
  const x1Chats = splitX1Chats(chats);

  if (x1Chats.groupSkipped > 0) {
    recordX1GroupSkips("chats", x1Chats.groupSkipped);
  }

  logSyncResult(
    "chats update",
    { chats: chats.length },
    await settleInBatches(x1Chats.allowed, upsertChatFromBaileys)
  );
}

export async function syncContactsUpsert(contacts: BaileysEventMap["contacts.upsert"]) {
  logSyncResult(
    "contacts upsert",
    { contacts: contacts.length },
    await settleInBatches(contacts, upsertContactFromBaileys)
  );
}

export async function syncContactsUpdate(contacts: BaileysEventMap["contacts.update"]) {
  logSyncResult(
    "contacts update",
    { contacts: contacts.length },
    await settleInBatches(contacts, upsertContactFromBaileys)
  );
}

export async function syncMessagesUpsert(event: BaileysEventMap["messages.upsert"]) {
  const x1Messages = splitX1Messages(event.messages);

  console.log("[sync] messages.upsert received", {
    count: event.messages.length,
    type: event.type,
    messages: event.messages.length
  });

  if (x1Messages.groupSkipped > 0) {
    recordX1GroupSkips("messages", x1Messages.groupSkipped);
  }

  const result = await settleInBatches(x1Messages.allowed, (message) =>
    upsertMessageFromBaileys(message, { log: true, logScope: "live" })
  );

  console.log("[history] live messages persisted", {
    type: event.type,
    count: result.processed,
    skipped: result.skipped,
    failed: result.failed,
    ...(result.firstError ? { firstError: result.firstError } : {})
  });

  logSyncResult("messages upsert", { type: event.type, messages: event.messages.length }, result);
}

export async function syncMessagesUpdate(messages: BaileysEventMap["messages.update"]) {
  const x1Messages = splitX1Messages(messages);

  if (x1Messages.groupSkipped > 0) {
    recordX1GroupSkips("messages", x1Messages.groupSkipped);
  }

  logSyncResult(
    "messages update",
    { messages: messages.length },
    await settleInBatches(x1Messages.allowed, updateMessageFromBaileys)
  );
}
