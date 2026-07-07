import { createHash } from "crypto";
import { prisma } from "../prisma/client";
import { normalizeBrazilPhone } from "../phone/normalize";
import { isGroupJid } from "../baileys/sync";

export type SkippedReason =
  | "group_excluded"
  | "opt_out"
  | "no_jid"
  | "already_sent_recently"
  | "invalid_jid"
  | "duplicate_in_campaign"
  | "max_recipients_reached";

export type AudienceCandidate = {
  chatId: string;
  jid: string;
  name: string | null;
  isGroup: boolean;
  phoneNormalized: string | null;
};

export type AudiencePreviewItem = {
  chatId: string;
  jid: string;
  name: string | null;
  isGroup: boolean;
  phoneNormalized: string | null;
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

async function loadOptedOutPhones(phones: string[]) {
  if (phones.length === 0) {
    return new Set<string>();
  }

  const contacts = await prisma.contact.findMany({
    where: {
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

async function loadRecentlySentJids(jids: string[], days: number) {
  if (days <= 0 || jids.length === 0) {
    return new Set<string>();
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [recipientRows, sendLogRows] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where: {
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
    already_sent_recently: 0,
    invalid_jid: 0,
    duplicate_in_campaign: 0,
    max_recipients_reached: 0
  };
}

export async function buildLabelAudience(options: {
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
      deleted: false
    }
  });

  if (!label) {
    return null;
  }

  const includeGroups = options.includeGroups ?? false;
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
      chat: search
        ? {
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
          isGroup: true
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  const skippedReasons = emptySkippedReasons();
  const seenJids = new Set<string>();
  const eligibleItems: AudiencePreviewItem[] = [];
  const phonesToCheck: string[] = [];

  for (const association of associations) {
    const jid = association.chat.jid;

    if (!jid) {
      skippedReasons.no_jid += 1;
      continue;
    }

    if (seenJids.has(jid)) {
      skippedReasons.duplicate_in_campaign += 1;
      continue;
    }

    seenJids.add(jid);

    if (!includeGroups && (association.chat.isGroup || isGroupJid(jid))) {
      skippedReasons.group_excluded += 1;
      continue;
    }

    const phoneNormalized = extractPhoneFromJid(jid);

    if (!includeGroups && !phoneNormalized) {
      skippedReasons.invalid_jid += 1;
      continue;
    }

    if (phoneNormalized) {
      phonesToCheck.push(phoneNormalized);
    }

    eligibleItems.push({
      chatId: association.chat.id,
      jid,
      name: association.chat.name,
      isGroup: association.chat.isGroup,
      phoneNormalized
    });
  }

  const optedOutPhones = excludeOptOut ? await loadOptedOutPhones(phonesToCheck) : new Set<string>();
  const recentlySentJids = await loadRecentlySentJids(
    eligibleItems.map((item) => item.jid),
    excludeAlreadySentDays
  );

  const finalEligible: AudiencePreviewItem[] = [];

  for (const item of eligibleItems) {
    if (finalEligible.length >= maxRecipients) {
      skippedReasons.max_recipients_reached += 1;
      continue;
    }

    if (item.phoneNormalized && optedOutPhones.has(item.phoneNormalized)) {
      skippedReasons.opt_out += 1;
      continue;
    }

    if (recentlySentJids.has(item.jid)) {
      skippedReasons.already_sent_recently += 1;
      continue;
    }

    finalEligible.push(item);
  }

  const skipped = associations.length - finalEligible.length;

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
