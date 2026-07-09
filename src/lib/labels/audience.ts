import { createHash } from "crypto";
import { prisma } from "../prisma/client";
import { normalizeBrazilPhone } from "../phone/normalize";
import { isGroupJid, normalizeChatJid } from "../baileys/sync";
import { WHATSAPP_X1_ONLY_MODE } from "../whatsapp/jid";
import { isEligibleIndividualWhatsappChat } from "../whatsapp/individual-chat-filter";
import { resolveContactDisplay } from "../whatsapp/contact-display";

export type SkippedReason =
  | "group_excluded"
  | "opt_out"
  | "no_jid"
  | "unresolved_chat"
  | "broadcast_or_status"
  | "already_sent_recently"
  | "invalid_jid"
  | "duplicate_in_campaign"
  | "unresolved_lid"
  | "max_recipients_reached";

export type AudienceJidType = "phone_jid" | "lid_jid" | "group_jid";

export type AudienceCandidate = {
  chatId: string;
  jid: string;
  name: string | null;
  isGroup: boolean;
  phoneNormalized: string | null;
  jidType: AudienceJidType;
};

export type AudiencePreviewItem = {
  chatId: string;
  jid: string;
  name: string | null;
  displayName?: string;
  displayPhone?: string | null;
  displaySubtitle?: string | null;
  rawJid?: string | null;
  isGroup: boolean;
  phoneNormalized: string | null;
  jidType: AudienceJidType;
};

export type AudienceResult = {
  label: {
    id: string;
    waLabelId: string;
    name: string;
    color: string | null;
    deleted: boolean;
  };
  total: number;
  eligible: number;
  skipped: number;
  skippedReasons: Record<SkippedReason, number>;
  jidTypeCounts: Record<AudienceJidType, number>;
  x1OnlyMode: boolean;
  recipientsPreview: AudiencePreviewItem[];
};

const DEFAULT_MAX_RECIPIENTS = 100;
const DEFAULT_EXCLUDE_ALREADY_SENT_DAYS = 7;
const ABSOLUTE_MAX_RECIPIENTS = 500;

function hashMessage(message: string) {
  return createHash("sha256").update(message.trim()).digest("hex").slice(0, 32);
}

function extractPhoneFromJid(jid: string) {
  if (!jid.endsWith("@s.whatsapp.net")) {
    return null;
  }

  const phone = jid.split("@")[0]?.split(":")[0] ?? "";
  const normalized = normalizeBrazilPhone(phone);
  return normalized.ok ? normalized.normalized : null;
}

function getJidLocalPart(jid: string) {
  return jid.split("@")[0]?.split(":")[0] ?? "";
}

function looksLikeRawPhone(value: string) {
  return /^[+\d\s().-]+$/.test(value);
}

function isBroadcastOrStatusJid(value: string) {
  const normalized = value.trim().toLowerCase();

  return (
    normalized === "status@broadcast" ||
    normalized.includes("broadcast") ||
    normalized.includes("newsletter") ||
    normalized.includes("channel")
  );
}

export type CampaignJidResolution =
  | {
      ok: true;
      jid: string;
      isGroup: boolean;
      phoneNormalized: string | null;
      jidType: AudienceJidType;
    }
  | {
      ok: false;
      reason: SkippedReason;
    };

function classifyCampaignJid(value: string | null | undefined): CampaignJidResolution {
  const raw = value?.trim();

  if (!raw) {
    return { ok: false, reason: "unresolved_chat" };
  }

  if (isBroadcastOrStatusJid(raw)) {
    return { ok: false, reason: "broadcast_or_status" };
  }

  if (!raw.includes("@")) {
    if (!looksLikeRawPhone(raw)) {
      return { ok: false, reason: "unresolved_chat" };
    }

    const normalizedPhone = normalizeBrazilPhone(raw);

    if (!normalizedPhone.ok) {
      return { ok: false, reason: "invalid_jid" };
    }

    return {
      ok: true,
      jid: `${normalizedPhone.normalized}@s.whatsapp.net`,
      isGroup: false,
      phoneNormalized: normalizedPhone.normalized,
      jidType: "phone_jid"
    };
  }

  const jid = normalizeChatJid(raw);

  if (!jid) {
    return { ok: false, reason: "invalid_jid" };
  }

  if (isBroadcastOrStatusJid(jid)) {
    return { ok: false, reason: "broadcast_or_status" };
  }

  if (isGroupJid(jid)) {
    return {
      ok: true,
      jid,
      isGroup: true,
      phoneNormalized: null,
      jidType: "group_jid"
    };
  }

  const localPart = getJidLocalPart(jid);

  if (jid.endsWith("@s.whatsapp.net")) {
    if (!/^\d+$/.test(localPart)) {
      return { ok: false, reason: "invalid_jid" };
    }

    return {
      ok: true,
      jid,
      isGroup: false,
      phoneNormalized: extractPhoneFromJid(jid),
      jidType: "phone_jid"
    };
  }

  if (jid.endsWith("@lid")) {
    if (!localPart) {
      return { ok: false, reason: "invalid_jid" };
    }

    return {
      ok: true,
      jid,
      isGroup: false,
      phoneNormalized: null,
      jidType: "lid_jid"
    };
  }

  return { ok: false, reason: "invalid_jid" };
}

export function resolveCampaignJid(
  candidates: Array<string | null | undefined>
): CampaignJidResolution {
  let fallbackReason: SkippedReason | null = null;

  for (const candidate of candidates) {
    const result = classifyCampaignJid(candidate);

    if (result.ok) {
      return result;
    }

    if (result.reason === "unresolved_chat") {
      continue;
    }

    fallbackReason ??= result.reason;
  }

  return { ok: false, reason: fallbackReason ?? "unresolved_chat" };
}

function logRecipientSkipped(reason: SkippedReason) {
  console.log("[campaign] recipient skipped", { reason });
}

async function loadOptedOutPhones(phones: string[], instanceId: string) {
  if (phones.length === 0) {
    return new Set<string>();
  }

  const contacts = await prisma.contact.findMany({
    where: {
      instanceId,
      phoneNormalized: {
        in: phones
      },
      optedOut: true
    },
    select: {
      phoneNormalized: true
    }
  });

  return new Set(contacts.map((contact) => contact.phoneNormalized));
}

async function loadRecentlySentJids(jids: string[], days: number, instanceId: string) {
  if (days <= 0 || jids.length === 0) {
    return new Set<string>();
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [recipientRows, sendLogRows] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where: {
        instanceId,
        jid: {
          in: jids
        },
        status: "sent",
        sentAt: {
          gte: since
        }
      },
      select: {
        jid: true
      }
    }),
    prisma.sendLog.findMany({
      where: {
        instanceId,
        jid: {
          in: jids
        },
        status: "sent",
        sentAt: {
          gte: since
        }
      },
      select: {
        jid: true
      }
    })
  ]);

  const recentlySent = new Set<string>();

  for (const row of recipientRows) {
    if (row.jid) {
      recentlySent.add(row.jid);
    }
  }

  for (const row of sendLogRows) {
    recentlySent.add(row.jid);
  }

  return recentlySent;
}

function emptySkippedReasons(): Record<SkippedReason, number> {
  return {
    group_excluded: 0,
    opt_out: 0,
    no_jid: 0,
    unresolved_chat: 0,
    broadcast_or_status: 0,
    already_sent_recently: 0,
    invalid_jid: 0,
    duplicate_in_campaign: 0,
    unresolved_lid: 0,
    max_recipients_reached: 0
  };
}

function emptyJidTypeCounts(): Record<AudienceJidType, number> {
  return {
    phone_jid: 0,
    lid_jid: 0,
    group_jid: 0
  };
}

export async function buildLabelAudience(options: {
  instanceId: string;
  labelId: string;
  includeGroups?: boolean;
  excludeOptOut?: boolean;
  excludeAlreadySentDays?: number;
  limit?: number;
  search?: string;
  maxRecipients?: number;
}) {
  const label = await prisma.whatsappLabel.findFirst({
    where: {
      id: options.labelId,
      instanceId: options.instanceId,
      deleted: false
    }
  });

  if (!label) {
    return null;
  }

  const includeGroups = WHATSAPP_X1_ONLY_MODE ? false : options.includeGroups ?? false;
  const excludeOptOut = options.excludeOptOut ?? true;
  const excludeAlreadySentDays =
    options.excludeAlreadySentDays ?? DEFAULT_EXCLUDE_ALREADY_SENT_DAYS;
  const previewLimit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const maxRecipients = Math.min(
    Math.max(options.maxRecipients ?? DEFAULT_MAX_RECIPIENTS, 1),
    ABSOLUTE_MAX_RECIPIENTS
  );
  const search = options.search?.trim().toLowerCase() ?? "";

  const associations = await prisma.whatsappChatLabel.findMany({
    where: {
      labelId: label.id,
      instanceId: options.instanceId,
      chat: search
        ? {
            instanceId: options.instanceId,
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { jid: { contains: search, mode: "insensitive" } }
            ]
          }
        : undefined
    },
    include: {
      chat: {
        select: {
          id: true,
          jid: true,
          name: true,
          isGroup: true,
          lastInboundAt: true,
          lastOutboundAt: true,
          lastMessageAt: true,
          lastMessageText: true,
          unreadCount: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });
  const associationJids = Array.from(new Set(associations.map((association) => association.chat.jid)));
  const contacts = associationJids.length
    ? await prisma.whatsappContact.findMany({
        where: {
          instanceId: options.instanceId,
          jid: {
            in: associationJids
          }
        },
        select: {
          jid: true,
          name: true,
          pushName: true,
          phone: true
        }
      })
    : [];
  const contactByJid = new Map(contacts.map((contact) => [contact.jid, contact]));

  const skippedReasons = emptySkippedReasons();
  const seenJids = new Set<string>();
  const eligibleItems: AudiencePreviewItem[] = [];
  const phonesToCheck: string[] = [];
  const jidTypeCounts = emptyJidTypeCounts();

  for (const association of associations) {
    const resolvedJid = resolveCampaignJid([
      association.jid,
      association.chat.jid,
      association.chatId
    ]);

    if (!resolvedJid.ok) {
      skippedReasons[resolvedJid.reason] += 1;
      logRecipientSkipped(resolvedJid.reason);
      continue;
    }

    const { jid, jidType, phoneNormalized } = resolvedJid;
    const isGroup = association.chat.isGroup || resolvedJid.isGroup;
    const contact = contactByJid.get(jid);
    const display = resolveContactDisplay({
      jid,
      chatName: association.chat.name,
      name: contact?.name,
      pushName: contact?.pushName,
      phone: contact?.phone,
      phoneNormalized
    });

    if (seenJids.has(jid)) {
      skippedReasons.duplicate_in_campaign += 1;
      logRecipientSkipped("duplicate_in_campaign");
      continue;
    }

    seenJids.add(jid);
    jidTypeCounts[jidType] += 1;

    if (isGroup) {
      if (!includeGroups) {
        skippedReasons.group_excluded += 1;
        logRecipientSkipped("group_excluded");
        continue;
      }
    }

    if (
      !isEligibleIndividualWhatsappChat({
        jid,
        isGroup,
        lastInboundAt: association.chat.lastInboundAt,
        lastOutboundAt: association.chat.lastOutboundAt,
        lastMessageAt: association.chat.lastMessageAt,
        lastMessageText: association.chat.lastMessageText,
        unreadCount: association.chat.unreadCount
      })
    ) {
      skippedReasons.unresolved_chat += 1;
      logRecipientSkipped("unresolved_chat");
      continue;
    }

    const resolvedPhone = phoneNormalized ?? contact?.phone ?? null;

    if (resolvedPhone) {
      phonesToCheck.push(resolvedPhone);
    }

    eligibleItems.push({
      chatId: association.chat.id,
      jid,
      name: display.displayName,
      displayName: display.displayName,
      displayPhone: display.displayPhone,
      displaySubtitle: display.displaySubtitle,
      rawJid: display.rawJid,
      isGroup,
      phoneNormalized: resolvedPhone,
      jidType
    });
  }

  const optedOutPhones = excludeOptOut
    ? await loadOptedOutPhones(phonesToCheck, options.instanceId)
    : new Set<string>();
  const recentlySentJids = await loadRecentlySentJids(
    eligibleItems.map((item) => item.jid),
    excludeAlreadySentDays,
    options.instanceId
  );

  const finalEligible: AudiencePreviewItem[] = [];

  for (const item of eligibleItems) {
    if (finalEligible.length >= maxRecipients) {
      skippedReasons.max_recipients_reached += 1;
      logRecipientSkipped("max_recipients_reached");
      continue;
    }

    if (item.phoneNormalized && optedOutPhones.has(item.phoneNormalized)) {
      skippedReasons.opt_out += 1;
      logRecipientSkipped("opt_out");
      continue;
    }

    if (recentlySentJids.has(item.jid)) {
      skippedReasons.already_sent_recently += 1;
      logRecipientSkipped("already_sent_recently");
      continue;
    }

    finalEligible.push(item);
  }

  const skipped = associations.length - finalEligible.length;

  console.log("[campaign] audience resolved", {
    valid: finalEligible.length,
    skippedGroups: skippedReasons.group_excluded,
    x1OnlyMode: WHATSAPP_X1_ONLY_MODE,
    invalidJids: skippedReasons.invalid_jid,
    duplicates: skippedReasons.duplicate_in_campaign,
    unresolved: skippedReasons.unresolved_chat
  });

  return {
    label: {
      id: label.id,
      waLabelId: label.waLabelId,
      name: label.name,
      color: label.color,
      deleted: label.deleted
    },
    total: associations.length,
    eligible: finalEligible.length,
    skipped,
    skippedReasons,
    jidTypeCounts,
    x1OnlyMode: WHATSAPP_X1_ONLY_MODE,
    eligibleRecipients: finalEligible,
    recipientsPreview: finalEligible.slice(0, previewLimit)
  } satisfies AudienceResult & {
    eligibleRecipients: AudiencePreviewItem[];
  };
}

export function buildCampaignDedupeKey(campaignId: string, jid: string) {
  return `${campaignId}:${jid}`;
}

export { hashMessage, DEFAULT_MAX_RECIPIENTS, DEFAULT_EXCLUDE_ALREADY_SENT_DAYS, ABSOLUTE_MAX_RECIPIENTS };

