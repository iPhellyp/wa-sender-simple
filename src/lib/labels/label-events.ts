import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";
import { classifyJid } from "../internal-api/jid";
import { InternalApiError } from "../internal-api/errors";
import { enqueueCrmLabelEventDelivery } from "./crm-push";

export type LabelEventOperation = "APPLY" | "REMOVE";
export type LabelEventSource = "INTERNAL_API" | "WHATSAPP" | "UNKNOWN";

type LabelAssociationChange = {
  instanceId: string;
  chatId: string;
  labelId: string;
  waLabelId: string;
  jid: string;
  operation: LabelEventOperation;
  source: LabelEventSource;
  correlationKey?: string | null;
  observedAt?: Date;
  phoneNormalized?: string | null;
};

type LabelEventTransaction = {
  $executeRaw(query: Prisma.Sql): Promise<number>;
  $queryRaw(query: Prisma.Sql): Promise<unknown>;
};

type PendingMutation = {
  correlationKey: string | null;
  expiresAt: number;
};

const pendingInternalMutations = new Map<string, PendingMutation>();
const PENDING_MUTATION_TTL_MS = 120_000;
const MAX_PAGE_SIZE = 200;

function pendingMutationKey(input: {
  instanceId: string;
  jid: string;
  waLabelId: string;
  operation: LabelEventOperation;
}) {
  return [input.instanceId, input.jid, input.waLabelId, input.operation].join("\u0000");
}

function cleanCorrelationKey(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 128) : null;
}

export function normalizeLabelEventJid(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed.length > 255 || /\s/.test(trimmed)) {
    return null;
  }

  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) {
    return null;
  }

  const local = trimmed.slice(0, atIndex).split(":")[0];
  const server = trimmed.slice(atIndex + 1);
  return local && server ? `${local}@${server}` : null;
}

export function classifyLabelEventTarget(jid: string, resolvedPhone?: string | null) {
  const type = classifyJid(jid);
  const jidPhone =
    type === "individual_phone" ? jid.slice(0, jid.lastIndexOf("@")) : null;
  const phoneNormalized =
    jidPhone && /^\d+$/.test(jidPhone)
      ? jidPhone
      : resolvedPhone && /^\d+$/.test(resolvedPhone)
        ? resolvedPhone
        : null;

  if (type === "individual_phone") {
    return {
      phoneNormalized,
      eligibleForCrm: Boolean(phoneNormalized),
      ineligibleReason: phoneNormalized ? null : "INVALID_PHONE"
    };
  }

  if (type === "lid") {
    return {
      phoneNormalized,
      eligibleForCrm: Boolean(phoneNormalized),
      ineligibleReason: phoneNormalized ? null : "LID_UNRESOLVED"
    };
  }

  const reasons = {
    group: "GROUP",
    broadcast: "BROADCAST",
    status: "BROADCAST",
    newsletter: "BROADCAST"
  } as const;

  return {
    phoneNormalized: null,
    eligibleForCrm: false,
    ineligibleReason: type in reasons
      ? reasons[type as keyof typeof reasons]
      : "UNSUPPORTED_JID"
  };
}

export function registerPendingInternalLabelMutation(input: {
  instanceId: string;
  jid: string;
  waLabelId: string;
  operation: LabelEventOperation;
  correlationKey?: string | null;
}) {
  pendingInternalMutations.set(pendingMutationKey(input), {
    correlationKey: cleanCorrelationKey(input.correlationKey),
    expiresAt: Date.now() + PENDING_MUTATION_TTL_MS
  });
}

export function consumePendingInternalLabelMutation(input: {
  instanceId: string;
  jid: string;
  waLabelId: string;
  operation: LabelEventOperation;
}) {
  const key = pendingMutationKey(input);
  const pending = pendingInternalMutations.get(key);
  pendingInternalMutations.delete(key);

  if (!pending || pending.expiresAt < Date.now()) {
    return null;
  }

  return pending;
}

export function clearPendingInternalLabelMutation(input: {
  instanceId: string;
  jid: string;
  waLabelId: string;
  operation: LabelEventOperation;
}) {
  pendingInternalMutations.delete(pendingMutationKey(input));
}

export async function persistLabelAssociationChange(
  transaction: LabelEventTransaction,
  change: LabelAssociationChange
) {
  const associationRowsChanged =
    change.operation === "APPLY"
      ? await transaction.$executeRaw(
          Prisma.sql`
            INSERT INTO "WhatsappChatLabel" (
              "id", "instanceId", "chatId", "labelId", "jid", "createdAt", "updatedAt"
            )
            VALUES (
              ${randomUUID()}, ${change.instanceId}, ${change.chatId},
              ${change.labelId}, ${change.jid}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT ("instanceId", "chatId", "labelId") DO NOTHING
          `
        )
      : await transaction.$executeRaw(
          Prisma.sql`
            DELETE FROM "WhatsappChatLabel"
            WHERE "instanceId" = ${change.instanceId}
              AND "chatId" = ${change.chatId}
              AND "labelId" = ${change.labelId}
          `
        );

  if (associationRowsChanged !== 1) {
    return { changed: false, eventId: null };
  }

  const target = classifyLabelEventTarget(change.jid, change.phoneNormalized);
  const eventId = randomUUID();
  const activeLabels = await transaction.$queryRaw(Prisma.sql`
    SELECT l."waLabelId", l."name"
    FROM "WhatsappChatLabel" cl
    JOIN "WhatsappLabel" l ON l."id" = cl."labelId"
    WHERE cl."instanceId" = ${change.instanceId} AND cl."chatId" = ${change.chatId}
      AND l."deleted" = false
    ORDER BY l."waLabelId" ASC
    LIMIT 100
  `) as Array<{ waLabelId: string; name: string }>;
  const currentRemoteLabelIds = [...new Set(activeLabels.map((label) => label.waLabelId))];
  const waLabelName = activeLabels.find((label) => label.waLabelId === change.waLabelId)?.name ?? null;
  await transaction.$executeRaw(
    Prisma.sql`
      INSERT INTO "WhatsappLabelEvent" (
        "eventId", "instanceId", "chatId", "jid", "phoneNormalized",
        "waLabelId", "operation", "observedAt", "source", "correlationKey",
        "eligibleForCrm", "ineligibleReason"
      )
      VALUES (
        ${eventId}::uuid, ${change.instanceId}, ${change.chatId}, ${change.jid},
        ${target.phoneNormalized}, ${change.waLabelId},
        ${change.operation}::"WhatsappLabelEventOperation",
        ${change.observedAt ?? new Date()},
        ${change.source}::"WhatsappLabelEventSource",
        ${cleanCorrelationKey(change.correlationKey)}, ${target.eligibleForCrm},
        ${target.ineligibleReason}
      )
    `
  );
  await enqueueCrmLabelEventDelivery(transaction, {
    eventId,
    instanceId: change.instanceId,
    chatId: change.chatId,
    jid: change.jid,
    phoneNormalized: target.phoneNormalized,
    waLabelId: change.waLabelId,
    operation: change.operation,
    source: change.source,
    observedAt: (change.observedAt ?? new Date()).toISOString(),
    eligibleForCrm: target.eligibleForCrm,
    ineligibleReason: target.ineligibleReason,
    correlationKey: cleanCorrelationKey(change.correlationKey),
    waLabelName,
    currentRemoteLabelIds
  });

  return { changed: true, eventId };
}

export async function recordLabelAssociationChange(
  change: Omit<LabelAssociationChange, "chatId" | "phoneNormalized"> & {
    chatId?: string;
  }
) {
  const jid = normalizeLabelEventJid(change.jid);
  if (!jid) {
    return { changed: false, eventId: null, skipped: "INVALID_JID" as const };
  }

  const [knownContact, knownIdentity, chat] = await Promise.all([
    jid.endsWith("@lid")
      ? prisma.whatsappContact.findUnique({
          where: { instanceId_jid: { instanceId: change.instanceId, jid } },
          select: { phone: true }
        })
      : Promise.resolve(null),
    jid.endsWith("@lid")
      ? prisma.whatsappIdentity.findUnique({
          where: { instanceId_lidJid: { instanceId: change.instanceId, lidJid: jid } },
          select: { phoneNormalized: true, confidence: true }
        })
      : Promise.resolve(null),
    change.chatId
      ? Promise.resolve({ id: change.chatId })
      : prisma.whatsappChat.upsert({
          where: { instanceId_jid: { instanceId: change.instanceId, jid } },
          update: { isGroup: classifyJid(jid) === "group" },
          create: {
            instanceId: change.instanceId,
            jid,
            isGroup: classifyJid(jid) === "group"
          },
          select: { id: true }
        })
  ]);

  return prisma.$transaction((transaction) =>
    persistLabelAssociationChange(transaction, {
      ...change,
      jid,
      chatId: chat.id,
      phoneNormalized: knownContact?.phone ?? (
        knownIdentity?.confidence === "DETERMINISTIC"
          ? knownIdentity.phoneNormalized
          : null
      )
    })
  );
}

export function encodeLabelEventCursor(id: bigint) {
  return Buffer.from(`v1:${id.toString()}`, "utf8").toString("base64url");
}

export function decodeLabelEventCursor(cursor: string | null | undefined) {
  if (!cursor) {
    return BigInt(0);
  }

  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^v1:\d+$/.test(decoded)) {
      throw new Error("invalid cursor");
    }
    return BigInt(decoded.slice(3));
  } catch {
    throw new InternalApiError("VALIDATION_ERROR", "Cursor inválido", 400);
  }
}

export function parseLabelEventPage(searchParams: URLSearchParams) {
  const rawLimit = searchParams.get("limit") ?? "100";
  if (!/^\d+$/.test(rawLimit)) {
    throw new InternalApiError("VALIDATION_ERROR", "Limite inválido", 400);
  }

  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new InternalApiError("VALIDATION_ERROR", "Limite inválido", 400);
  }

  const after = searchParams.get("after");
  return { after, afterId: decodeLabelEventCursor(after), limit };
}

type LabelEventRow = {
  id: bigint;
  eventId: string;
  instanceId: string;
  chatId: string;
  jid: string;
  phoneNormalized: string | null;
  waLabelId: string;
  operation: LabelEventOperation;
  source: LabelEventSource;
  observedAt: Date;
  eligibleForCrm: boolean;
  ineligibleReason: string | null;
};

export async function listLabelEvents(searchParams: URLSearchParams) {
  const page = parseLabelEventPage(searchParams);
  const rows = await prisma.$queryRaw<LabelEventRow[]>(
    Prisma.sql`
      SELECT
        "id", "eventId", "instanceId", "chatId", "jid", "phoneNormalized",
        "waLabelId", "operation", "source", "observedAt",
        "eligibleForCrm", "ineligibleReason"
      FROM "WhatsappLabelEvent"
      WHERE "id" > ${page.afterId}
      ORDER BY "id" ASC
      LIMIT ${page.limit + 1}
    `
  );
  const hasMore = rows.length > page.limit;
  const selected = hasMore ? rows.slice(0, page.limit) : rows;
  const lastId = selected.at(-1)?.id;

  return {
    events: selected.map(({ id: _id, ...event }) => ({
      ...event,
      observedAt: event.observedAt.toISOString()
    })),
    nextCursor: lastId
      ? encodeLabelEventCursor(lastId)
      : page.after,
    hasMore
  };
}
