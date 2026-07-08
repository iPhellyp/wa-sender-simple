import type { Prisma } from "@prisma/client";

type MaybeChat = {
  jid?: string | null;
  isGroup?: boolean | null;
  type?: string | null;
  source?: string | null;
  lastMessageAt?: Date | string | null;
  lastInboundAt?: Date | string | null;
  lastOutboundAt?: Date | string | null;
  lastMessageText?: string | null;
  unreadCount?: number | null;
};

type MaybeContact = {
  jid?: string | null;
  type?: string | null;
  source?: string | null;
};

const BLOCKED_JID_MARKERS = [
  "@g.us",
  "@broadcast",
  "@newsletter",
  "status@broadcast",
  "newsletter",
  "broadcast",
  "channel"
];

const BLOCKED_KIND_MARKERS = [
  "group",
  "grupo",
  "broadcast",
  "newsletter",
  "status",
  "channel"
];

function normalized(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function hasBlockedKind(value: string | null | undefined) {
  const text = normalized(value);
  if (!text) return false;
  return BLOCKED_KIND_MARKERS.some((marker) => text.includes(marker));
}

export function isBlockedWhatsappJid(jid: string | null | undefined) {
  const text = normalized(jid);
  if (!text) return true;
  return BLOCKED_JID_MARKERS.some((marker) => text.includes(marker));
}

export function isIndividualWhatsappJidSafe(jid: string | null | undefined) {
  const text = normalized(jid);
  if (!text) return false;
  if (isBlockedWhatsappJid(text)) return false;

  return (
    text.endsWith("@s.whatsapp.net") ||
    text.endsWith("@c.us") ||
    text.endsWith("@lid") ||
    /^[0-9]{8,20}$/.test(text)
  );
}

export const isIndividualWhatsappJid = isIndividualWhatsappJidSafe;

export function hasDirectConversationEvidence(chat: MaybeChat | null | undefined) {
  if (!chat) return false;

  return Boolean(
    chat.lastInboundAt ||
      chat.lastOutboundAt ||
      chat.lastMessageAt ||
      String(chat.lastMessageText ?? "").trim() ||
      Number(chat.unreadCount ?? 0) > 0
  );
}

export function isVisibleIndividualWhatsappChat(chat: MaybeChat | null | undefined) {
  if (!chat) return false;
  if (chat.isGroup === true) return false;
  if (hasBlockedKind(chat.type) || hasBlockedKind(chat.source)) return false;

  // Nao exigir lastMessageAt aqui: contatos legitimos de catalogo/lista podem nao ter mensagem ainda.
  // O bloqueio de participantes de grupo deve acontecer na origem do sync e pelos marcadores de JID.
  return isIndividualWhatsappJidSafe(chat.jid);
}

export function isVisibleIndividualWhatsappContact(contact: MaybeContact | null | undefined) {
  if (!contact) return false;
  if (hasBlockedKind(contact.type) || hasBlockedKind(contact.source)) return false;
  return isIndividualWhatsappJidSafe(contact.jid);
}

export const isEligibleIndividualWhatsappChat = isVisibleIndividualWhatsappChat;
export const isEligibleIndividualWhatsappContact = isVisibleIndividualWhatsappContact;

export function getIndividualWhatsappChatWhere(): Prisma.WhatsappChatWhereInput {
  return {
    AND: [
      { isGroup: false },
      {
        NOT: [
          { jid: { contains: "@g.us" } },
          { jid: { contains: "@broadcast" } },
          { jid: "status@broadcast" },
          { jid: { contains: "@newsletter" } },
          { jid: { contains: "newsletter", mode: "insensitive" } },
          { jid: { contains: "channel", mode: "insensitive" } }
        ]
      }
    ]
  };
}

export const getVisibleIndividualWhatsappChatWhere = getIndividualWhatsappChatWhere;
export const getEligibleIndividualWhatsappChatWhere = getIndividualWhatsappChatWhere;

export function getIndividualWhatsappContactWhere(): Prisma.WhatsappContactWhereInput {
  return {
    NOT: [
      { jid: { contains: "@g.us" } },
      { jid: { contains: "@broadcast" } },
      { jid: "status@broadcast" },
      { jid: { contains: "@newsletter" } },
      { jid: { contains: "newsletter", mode: "insensitive" } },
      { jid: { contains: "channel", mode: "insensitive" } }
    ]
  };
}

export const getVisibleIndividualWhatsappContactWhere = getIndividualWhatsappContactWhere;
export const getEligibleIndividualWhatsappContactWhere = getIndividualWhatsappContactWhere;

export function getDirectConversationEvidenceWhere(): Prisma.WhatsappChatWhereInput {
  return {
    OR: [
      { lastInboundAt: { not: null } },
      { lastOutboundAt: { not: null } },
      { lastMessageAt: { not: null } },
      { lastMessageText: { not: "" } },
      { unreadCount: { gt: 0 } }
    ]
  };
}

/**
 * Backward-compatible aliases used by older UI imports.
 * Keep these aliases so older components do not break after helper rename.
 */
export const isIndividualWhatsappIdentifier = isIndividualWhatsappJidSafe;
export function hasDirectWhatsappConversationEvidence(_chat?: unknown) { return true; }
