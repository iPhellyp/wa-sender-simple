import type { BaileysEventMap } from "@whiskeysockets/baileys";
import { prisma } from "../prisma/client";
import { DEFAULT_WHATSAPP_INSTANCE_ID } from "../server/whatsapp-instances";
import { isGroupJid } from "./sync";
import {
  classifyLabelEventTarget,
  consumePendingInternalLabelMutation,
  normalizeLabelEventJid,
  recordLabelAssociationChange,
  type LabelEventOperation
} from "../labels/label-events";

const CHAT_LABEL_TYPE = "label_jid";
const associationQueues = new Map<string, Promise<void>>();

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

export async function upsertWhatsappLabel(
  label: LabelEditEvent,
  instanceId = DEFAULT_WHATSAPP_INSTANCE_ID
) {
  const waLabelId = String(label.id ?? "").trim();

  if (!waLabelId) {
    return { processed: 0, skipped: 1, failed: 0 };
  }

  await prisma.whatsappLabel.upsert({
    where: {
      instanceId_waLabelId: {
        instanceId,
        waLabelId
      }
    },
    update: {
      name: safeLabelName(label.name, waLabelId),
      color: labelColorToString(label.color),
      predefined: Boolean(label.predefinedId),
      deleted: Boolean(label.deleted),
      rawJson: buildLabelRawJson(label)
    },
    create: {
      instanceId,
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

export async function upsertWhatsappLabels(
  labels: LabelEditEvent[],
  instanceId = DEFAULT_WHATSAPP_INSTANCE_ID
) {
  const counters = { instanceId, labels: labels.length, processed: 0, skipped: 0, failed: 0 };

  for (const label of labels) {
    try {
      const result = await upsertWhatsappLabel(label, instanceId);
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

  console.log("[catalog] labels saved", counters);
  return counters;
}

async function resolveLabelByWaId(waLabelId: string, instanceId = DEFAULT_WHATSAPP_INSTANCE_ID) {
  return prisma.whatsappLabel.findUnique({
    where: {
      instanceId_waLabelId: {
        instanceId,
        waLabelId
      }
    }
  });
}

async function resolveLabelForAssociation(
  waLabelId: string,
  operation: LabelEventOperation,
  instanceId: string
) {
  const existing = await resolveLabelByWaId(waLabelId, instanceId);

  if (existing || operation === "REMOVE") {
    return existing;
  }

  return prisma.whatsappLabel.upsert({
    where: {
      instanceId_waLabelId: {
        instanceId,
        waLabelId
      }
    },
    update: {},
    create: {
      instanceId,
      waLabelId,
      name: safeLabelName(null, waLabelId),
      predefined: false,
      deleted: false
    }
  });
}

export async function syncLabelsEdit(
  label: LabelEditEvent,
  instanceId = DEFAULT_WHATSAPP_INSTANCE_ID
) {
  return upsertWhatsappLabels([label], instanceId);
}

async function syncLabelsAssociationNow(
  event: LabelAssociationEvent,
  instanceId = DEFAULT_WHATSAPP_INSTANCE_ID
) {
  const counters = {
    associations: 1,
    processed: 0,
    x1Saved: 0,
    groupsSkipped: 0,
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

    const jid = normalizeLabelEventJid(association.chatId);
    const waLabelId = String(association.labelId ?? "").trim();

    if (!jid || !waLabelId) {
      counters.skipped = 1;
      return counters;
    }

    if (event.type !== "add" && event.type !== "remove") {
      counters.skipped = 1;
      return counters;
    }

    const operation: LabelEventOperation =
      event.type === "remove" ? "REMOVE" : "APPLY";
    const label = await resolveLabelForAssociation(waLabelId, operation, instanceId);

    if (!label || (event.type === "add" && label.deleted)) {
      counters.skipped = 1;
      return counters;
    }

    const pending = consumePendingInternalLabelMutation({
      instanceId,
      jid,
      waLabelId,
      operation
    });
    const result = await recordLabelAssociationChange({
      instanceId,
      labelId: label.id,
      waLabelId,
      jid,
      operation,
      source: pending ? "INTERNAL_API" : "WHATSAPP",
      correlationKey: pending?.correlationKey
    });
    const target = classifyLabelEventTarget(jid);

    if (!result.changed) {
      counters.skipped = 1;
      console.log("[catalog] associations saved", counters);
      return counters;
    }

    counters.processed = 1;
    counters.removed = operation === "REMOVE" ? 1 : 0;
    counters.x1Saved = target.eligibleForCrm ? 1 : 0;
    counters.groupsSkipped = isGroupJid(jid) ? 1 : 0;
  } catch (error) {
    counters.failed = 1;
    console.warn("[sync] labels association failed", {
      error: sanitizeSyncError(error)
    });
  }

  console.log("[catalog] associations saved", counters);
  return counters;
}

export async function syncLabelsAssociation(
  event: LabelAssociationEvent,
  instanceId = DEFAULT_WHATSAPP_INSTANCE_ID
) {
  const previous = associationQueues.get(instanceId) ?? Promise.resolve();
  const current = previous.then(() => syncLabelsAssociationNow(event, instanceId));
  const tail = current.then(() => undefined, () => undefined);
  associationQueues.set(instanceId, tail);

  try {
    return await current;
  } finally {
    if (associationQueues.get(instanceId) === tail) {
      associationQueues.delete(instanceId);
    }
  }
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
