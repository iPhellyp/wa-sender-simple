import type { BaileysEventMap } from "@whiskeysockets/baileys";
import { prisma } from "../prisma/client";
import { ensureChatForJid, isGroupJid, normalizeChatJid } from "./sync";
import { recordX1GroupSkips, shouldIgnoreJidForX1Only } from "../whatsapp/jid";

const CHAT_LABEL_TYPE = "label_jid";

type LabelEditEvent = BaileysEventMap["labels.edit"];
type LabelAssociationEvent = BaileysEventMap["labels.association"];

function sanitizeSyncError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Erro desconhecido";
}

export function safeLabelName(name: string | null | undefined, waLabelId: string) {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 ? trimmed.slice(0, 120) : `Etiqueta ${waLabelId}`;
}

export function labelColorToString(color: number | null | undefined) {
  if (color === null || color === undefined || Number.isNaN(color)) {
    return null;
  }

  return `color-${color}`;
}

function buildLabelRawJson(label: LabelEditEvent) {
  return {
    waLabelId: label.id,
    color: label.color,
    deleted: label.deleted,
    predefinedId: label.predefinedId ?? null
  };
}

export async function upsertWhatsappLabel(label: LabelEditEvent) {
  const waLabelId = String(label.id ?? "").trim();

  if (!waLabelId) {
    return { processed: 0, skipped: 1, failed: 0 };
  }

  await prisma.whatsappLabel.upsert({
    where: {
      waLabelId
    },
    update: {
      name: safeLabelName(label.name, waLabelId),
      color: labelColorToString(label.color),
      predefined: Boolean(label.predefinedId),
      deleted: Boolean(label.deleted),
      rawJson: buildLabelRawJson(label)
    },
    create: {
      waLabelId,
      name: safeLabelName(label.name, waLabelId),
      color: labelColorToString(label.color),
      predefined: Boolean(label.predefinedId),
      deleted: Boolean(label.deleted),
      rawJson: buildLabelRawJson(label)
    }
  });

  return { processed: 1, skipped: 0, failed: 0 };
}

export async function upsertWhatsappLabels(labels: LabelEditEvent[]) {
  const counters = { labels: labels.length, processed: 0, skipped: 0, failed: 0 };

  for (const label of labels) {
    try {
      const result = await upsertWhatsappLabel(label);
      counters.processed += result.processed;
      counters.skipped += result.skipped;
      counters.failed += result.failed;
    } catch (error) {
      counters.failed += 1;
      console.warn("[sync] labels edit item failed", {
        error: sanitizeSyncError(error)
      });
    }
  }

  console.log("[sync] labels edit", counters);
  return counters;
}

async function resolveLabelByWaId(waLabelId: string) {
  return prisma.whatsappLabel.findUnique({
    where: {
      waLabelId
    }
  });
}

export async function removeWhatsappLabelAssociation(chatId: string, labelInternalId: string) {
  await prisma.whatsappChatLabel.deleteMany({
    where: {
      chatId,
      labelId: labelInternalId
    }
  });
}

export async function upsertWhatsappLabelAssociation(
  jid: string,
  labelInternalId: string,
  chatId: string
) {
  await prisma.whatsappChatLabel.upsert({
    where: {
      chatId_labelId: {
        chatId,
        labelId: labelInternalId
      }
    },
    update: {
      jid
    },
    create: {
      chatId,
      labelId: labelInternalId,
      jid
    }
  });
}

export async function syncLabelsEdit(label: LabelEditEvent) {
  return upsertWhatsappLabels([label]);
}

export async function syncLabelsAssociation(event: LabelAssociationEvent) {
  const counters = {
    associations: 1,
    processed: 0,
    skipped: 0,
    removed: 0,
    failed: 0
  };

  try {
    const association = event.association;
    const associationType = String(association.type ?? "");

    if (associationType !== CHAT_LABEL_TYPE) {
      counters.skipped = 1;
      console.log("[sync] labels association skipped; message label not persisted", {
        type: associationType
      });
      return counters;
    }

    const jid = normalizeChatJid(association.chatId);
    const waLabelId = String(association.labelId ?? "").trim();

    if (!jid || !waLabelId) {
      counters.skipped = 1;
      return counters;
    }

    if (shouldIgnoreJidForX1Only(jid)) {
      counters.skipped = 1;
      if (isGroupJid(jid)) {
        recordX1GroupSkips("labels");
      }
      return counters;
    }

    const label = await resolveLabelByWaId(waLabelId);

    if (!label || label.deleted) {
      counters.skipped = 1;
      return counters;
    }

    const chat = await ensureChatForJid(jid);

    if (event.type === "remove") {
      await removeWhatsappLabelAssociation(chat.id, label.id);
      counters.removed = 1;
      counters.processed = 1;
      return counters;
    }

    await upsertWhatsappLabelAssociation(jid, label.id, chat.id);
    counters.processed = 1;
  } catch (error) {
    counters.failed = 1;
    console.warn("[sync] labels association failed", {
      error: sanitizeSyncError(error)
    });
  }

  console.log("[sync] labels association", counters);
  return counters;
}

export function isChatLabelAssociation(
  association: LabelAssociationEvent["association"]
): association is LabelAssociationEvent["association"] & { chatId: string; labelId: string } {
  return String(association.type) === CHAT_LABEL_TYPE;
}

export function summarizeLabelChat(jid: string) {
  return {
    jid,
    isGroup: isGroupJid(jid)
  };
}
