import { Worker } from "bullmq";
import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../lib/prisma/client";
import {
  CAMPAIGN_QUEUE_NAME,
  APPLY_WHATSAPP_LABELS_JOB,
  CONNECT_WHATSAPP_JOB,
  DISCONNECT_WHATSAPP_JOB,
  RESET_WHATSAPP_JOB,
  SEND_MANUAL_MESSAGE_JOB,
  SEND_RECIPIENT_JOB,
  SYNC_WHATSAPP_CATALOG_JOB,
  SYNC_WHATSAPP_HISTORY_JOB,
  enqueueRecipient,
  type ApplyWhatsappLabelsJobData,
  type SendManualMessageJobData,
  type SyncWhatsappCatalogJobData
} from "../lib/queue/campaign-queue";
import { getRedisConnectionOptions } from "../lib/queue/connection";
import {
  isBaileysStartSkippedError,
  markWhatsappError,
  requestWhatsappHistorySync
} from "../lib/baileys/client";
import {
  applyWhatsappLabelsForInstance,
  disconnectWhatsappInstance,
  reconnectWhatsappInstance,
  requestWhatsappCatalogSyncForInstance,
  resetWhatsappInstance,
  sendWhatsappMessageForInstance,
  sendWhatsappPhoneMessageForInstance
} from "../lib/baileys/instance-manager";
import { ensureChatForJid, isGroupJid, normalizeChatJid } from "../lib/baileys/sync";
import { completeCampaignIfDone } from "../lib/campaigns/progress";
import { schedulePendingRecipients } from "../lib/campaigns/schedule";
import { hashMessage, resolveCampaignJid, type SkippedReason } from "../lib/labels/audience";
import { normalizeBrazilPhone, toWhatsappJid } from "../lib/phone/normalize";
import { clearWhatsappOperationalData } from "../lib/server/whatsapp-session-data";
import { DEFAULT_WHATSAPP_INSTANCE_ID } from "../lib/server/whatsapp-instances";
import { shouldIgnoreJidForX1Only } from "../lib/whatsapp/jid";

const PAUSED_RECHECK_DELAY_MS = 60 * 1000;
const finalRecipientStatuses: CampaignRecipientStatus[] = [
  CampaignRecipientStatus.sent,
  CampaignRecipientStatus.failed,
  CampaignRecipientStatus.canceled
];
const redisConnectionOptions = getRedisConnectionOptions();

console.log("[worker] sender-worker started");
console.log("[worker] redis connection", {
  host: redisConnectionOptions.host,
  port: redisConnectionOptions.port,
  db: redisConnectionOptions.db
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

function getRequiredJobInstanceId(data: unknown, jobName: string) {
  const instanceId = String((data as { instanceId?: string } | undefined)?.instanceId ?? "").trim();

  if (!instanceId) {
    throw new Error(`${jobName} sem instanceId`);
  }

  return instanceId;
}

async function requeueRecipient(recipientId: string, delayMs = PAUSED_RECHECK_DELAY_MS) {
  await enqueueRecipient(recipientId, delayMs);
}

type SentWhatsappMessage = Awaited<ReturnType<typeof sendWhatsappMessageForInstance>>;

function buildFallbackMessageId(prefix: string, id: string | undefined) {
  return `${prefix}-${id ?? Date.now()}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 180);
}

async function persistOutboundMessage(options: {
  instanceId: string;
  jid: string;
  text: string;
  sentAt: Date;
  sentMessage: SentWhatsappMessage;
  fallbackMessageId: string;
}) {
  const normalizedJid = normalizeChatJid(options.jid);

  if (!normalizedJid) {
    throw new Error("JID invalido para persistir mensagem enviada");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("JID ignorado pelo modo de envio individual");
  }

  const scopedChat = await ensureChatForJid(normalizedJid, undefined, options.instanceId);
  const waMessageId = options.sentMessage.waMessageId ?? options.fallbackMessageId;

  await prisma.whatsappMessage.upsert({
    where: {
      instanceId_jid_waMessageId: {
        instanceId: options.instanceId,
        jid: normalizedJid,
        waMessageId
      }
    },
    update: {
      chatId: scopedChat.id,
      fromMe: true,
      senderJid: options.sentMessage.senderJid,
      timestamp: options.sentAt,
      messageType: "text",
      text: options.text,
      rawJson: options.sentMessage.rawJson
    },
    create: {
      chatId: scopedChat.id,
      instanceId: options.instanceId,
      jid: normalizedJid,
      waMessageId,
      fromMe: true,
      senderJid: options.sentMessage.senderJid,
      timestamp: options.sentAt,
      messageType: "text",
      text: options.text,
      rawJson: options.sentMessage.rawJson
    }
  });

  await prisma.whatsappChat.update({
    where: {
      id: scopedChat.id
    },
    data: {
      isGroup: isGroupJid(normalizedJid),
      lastMessageAt: options.sentAt,
      lastMessageText: options.text,
      lastOutboundAt: options.sentAt
    }
  });

  return scopedChat.id;
}

function getPhoneFromRecipientJid(jid: string | null | undefined) {
  if (!jid?.endsWith("@s.whatsapp.net")) {
    return null;
  }

  const phone = jid.split("@")[0]?.split(":")[0] ?? "";
  const normalized = normalizeBrazilPhone(phone);
  return normalized.ok ? normalized.normalized : null;
}

async function isRecipientOptedOut(
  recipient: {
    instanceId: string;
    jid: string | null;
    contact: { optedOut: boolean; phoneNormalized: string } | null;
  },
  resolvedJid?: string | null
) {
  if (recipient.contact?.optedOut) {
    return true;
  }

  const phone = getPhoneFromRecipientJid(recipient.jid ?? resolvedJid);

  if (!phone) {
    return false;
  }

  const contact = await prisma.contact.findFirst({
    where: {
      instanceId: recipient.instanceId,
      phoneNormalized: phone
    },
    select: {
      optedOut: true
    }
  });

  return Boolean(contact?.optedOut);
}

function getSkippedRecipientError(reason: SkippedReason) {
  if (reason === "group_excluded") {
    return "Grupo ignorado pelo modo de envio individual";
  }

  if (reason === "unresolved_chat") {
    return "Conversa sem JID resolvido para envio";
  }

  if (reason === "broadcast_or_status") {
    return "JID de broadcast/status ignorado";
  }

  return "JID invalido para envio";
}

async function resolveRecipientSendJid(recipient: {
  instanceId: string;
  jid: string | null;
  chatId: string | null;
}) {
  if (recipient.jid) {
    return resolveCampaignJid([recipient.jid]);
  }

  if (!recipient.chatId) {
    return resolveCampaignJid([]);
  }

  const chat = await prisma.whatsappChat.findFirst({
    where: {
      id: recipient.chatId,
      instanceId: recipient.instanceId
    },
    select: {
      jid: true
    }
  });

  return resolveCampaignJid([chat?.jid, recipient.chatId]);
}

async function processManualMessage(
  data: Partial<SendManualMessageJobData>,
  jobId: string | undefined
) {
  const chatId = String(data.chatId ?? "").trim();
  const normalizedJid = normalizeChatJid(data.jid);
  const text = String(data.text ?? "").trim();
  const requestedInstanceId = String(data.instanceId ?? "").trim();

  if (!chatId) {
    throw new Error("chatId obrigatorio para envio manual");
  }

  if (!normalizedJid) {
    throw new Error("JID invalido para envio manual");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("Envio manual para grupo ignorado pelo modo de envio individual");
  }

  if (!text) {
    throw new Error("Mensagem manual vazia");
  }

  if (text.length > 4000) {
    throw new Error("Mensagem manual excede 4000 caracteres");
  }

  const chat = await prisma.whatsappChat.findUnique({
    where: {
      id: chatId
    }
  });

  if (!chat) {
    throw new Error("Conversa nao encontrada para envio manual");
  }

  if (requestedInstanceId && requestedInstanceId !== chat.instanceId) {
    throw new Error("Instancia do job nao corresponde a conversa");
  }

  if (chat.jid !== normalizedJid) {
    throw new Error("JID do job nao corresponde a conversa");
  }

  try {
    console.log("[manual-send] sending with instance", {
      chatId,
      instanceId: chat.instanceId
    });
    const sentMessage = await sendWhatsappMessageForInstance(chat.instanceId, normalizedJid, text);
    const sentAt = new Date();
    await persistOutboundMessage({
      instanceId: chat.instanceId,
      jid: normalizedJid,
      text,
      sentAt,
      sentMessage,
      fallbackMessageId: buildFallbackMessageId("manual", jobId)
    });

    console.log("[worker] manual message sent", {
      chatId,
      jidType: isGroupJid(normalizedJid) ? "group" : "contact"
    });
  } catch (error) {
    console.error("[worker] manual message failed", {
      chatId,
      jidType: isGroupJid(normalizedJid) ? "group" : "contact",
      error: getErrorMessage(error)
    });
    throw error;
  }
}

async function processRecipient(recipientId: string) {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: {
      id: recipientId
    },
    include: {
      campaign: true,
      contact: true
    }
  });

  if (!recipient) {
    return;
  }

  if (finalRecipientStatuses.includes(recipient.status)) {
    return;
  }

  if (recipient.campaign.status === CampaignStatus.canceled) {
    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Campanha cancelada"
      }
    });
    return;
  }

  if (recipient.campaign.status !== CampaignStatus.running) {
    await requeueRecipient(recipient.id);
    return;
  }

  if (recipient.scheduledAt && recipient.scheduledAt.getTime() > Date.now()) {
    await requeueRecipient(recipient.id, recipient.scheduledAt.getTime() - Date.now());
    return;
  }

  let resolvedRecipientJid: string | null = null;

  if (recipient.jid || recipient.chatId || !recipient.contact) {
    const resolvedJid = await resolveRecipientSendJid(recipient);
    const skipReason =
      !resolvedJid.ok
        ? resolvedJid.reason
        : resolvedJid.isGroup || shouldIgnoreJidForX1Only(resolvedJid.jid)
          ? "group_excluded"
          : null;

    if (skipReason) {
      await prisma.campaignRecipient.update({
        where: {
          id: recipient.id
        },
        data: {
          status: CampaignRecipientStatus.canceled,
          jid: resolvedJid.ok ? resolvedJid.jid : recipient.jid,
          error: getSkippedRecipientError(skipReason),
          skippedReason: skipReason
        }
      });
      console.log("[campaign] recipient skipped", { reason: skipReason });
      await schedulePendingRecipients(recipient.campaignId);
      return;
    }

    if (resolvedJid.ok) {
      resolvedRecipientJid = resolvedJid.jid;
    }
  }

  if (await isRecipientOptedOut(recipient, resolvedRecipientJid)) {
    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Contato opt-out",
        skippedReason: "opt_out"
      }
    });
    await schedulePendingRecipients(recipient.campaignId);
    return;
  }

  await prisma.campaignRecipient.update({
    where: {
      id: recipient.id
    },
    data: {
      status: CampaignRecipientStatus.sending,
      error: null,
      attemptCount: {
        increment: 1
      },
      lastAttemptAt: new Date()
    }
  });

  try {
    let sentMessage: SentWhatsappMessage;
    let sentJid: string;

    if (resolvedRecipientJid) {
      sentJid = resolvedRecipientJid;
      console.log("[campaign] sending with instance", {
        campaignId: recipient.campaignId,
        instanceId: recipient.campaign.instanceId
      });
      sentMessage = await sendWhatsappMessageForInstance(
        recipient.campaign.instanceId,
        resolvedRecipientJid,
        recipient.messageFinal
      );
    } else if (recipient.contact) {
      sentJid = toWhatsappJid(recipient.contact.phoneNormalized);
      console.log("[campaign] sending with instance", {
        campaignId: recipient.campaignId,
        instanceId: recipient.campaign.instanceId
      });
      sentMessage = await sendWhatsappPhoneMessageForInstance(
        recipient.campaign.instanceId,
        recipient.contact.phoneNormalized,
        recipient.messageFinal
      );
    } else {
      throw new Error("Destinatario sem jid ou contato");
    }

    const sentAt = new Date();
    const persistedChatId = await persistOutboundMessage({
      instanceId: recipient.instanceId,
      jid: sentJid,
      text: recipient.messageFinal,
      sentAt,
      sentMessage,
      fallbackMessageId: buildFallbackMessageId("campaign", recipient.id)
    });

    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.sent,
        sentAt,
        jid: resolvedRecipientJid ? sentJid : recipient.jid,
        chatId: recipient.chatId ?? persistedChatId,
        error: null
      }
    });

    if (resolvedRecipientJid) {
      await prisma.sendLog.create({
        data: {
          instanceId: recipient.instanceId,
          jid: sentJid,
          chatId: recipient.chatId ?? persistedChatId,
          campaignId: recipient.campaignId,
          recipientId: recipient.id,
          messageHash: hashMessage(recipient.messageFinal),
          status: "sent",
          sentAt
        }
      });
    }

    console.log("[worker] campaign message sent", {
      recipientId: recipient.id,
      campaignId: recipient.campaignId,
      jidType: resolvedRecipientJid
        ? isGroupJid(resolvedRecipientJid)
          ? "group"
          : "contact"
        : "contact-sheet"
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro ao enviar mensagem";

    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.failed,
        jid: resolvedRecipientJid ? resolvedRecipientJid : recipient.jid,
        error: errorMessage
      }
    });

    if (resolvedRecipientJid) {
      await prisma.sendLog.create({
        data: {
          instanceId: recipient.instanceId,
          jid: resolvedRecipientJid,
          chatId: recipient.chatId,
          campaignId: recipient.campaignId,
          recipientId: recipient.id,
          messageHash: hashMessage(recipient.messageFinal),
          status: "failed",
          error: errorMessage
        }
      }).catch(() => undefined);
    }

    console.error("[worker] campaign message failed", {
      recipientId: recipient.id,
      campaignId: recipient.campaignId,
      error: errorMessage
    });
  }

  await completeCampaignIfDone(recipient.campaignId);
  await schedulePendingRecipients(
    recipient.campaignId,
    recipient.campaign.intervalMinutes * 60 * 1000
  );
}

const worker = new Worker(
  CAMPAIGN_QUEUE_NAME,
  async (job) => {
    console.log("[worker] job received", {
      name: job.name,
      id: job.id
    });

    if (job.name === CONNECT_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, CONNECT_WHATSAPP_JOB);
      console.log("[worker] connect-whatsapp job received", { instanceId });

      try {
        await reconnectWhatsappInstance(instanceId);
        console.log("[worker] connect-whatsapp finished", { instanceId });
      } catch (error) {
        if (isBaileysStartSkippedError(error)) {
          console.log("[worker] connect-whatsapp skipped", {
            reason: getErrorMessage(error)
          });
          return;
        }

        const lastError = `Falha ao iniciar conexao WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] connect-whatsapp failed", { instanceId, error: lastError });
        if (instanceId === DEFAULT_WHATSAPP_INSTANCE_ID) {
          await markWhatsappError(lastError);
        }
        throw error;
      }

      return;
    }

    if (job.name === DISCONNECT_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, DISCONNECT_WHATSAPP_JOB);
      console.log("[worker] disconnect-whatsapp job received", { instanceId });

      try {
        await clearWhatsappOperationalData("manual-disconnect-worker", instanceId);
        await disconnectWhatsappInstance(instanceId);
        console.log("[worker] disconnect-whatsapp finished", { instanceId });
      } catch (error) {
        const lastError = `Falha ao desconectar WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] disconnect-whatsapp failed", { instanceId, error: lastError });
        if (instanceId === DEFAULT_WHATSAPP_INSTANCE_ID) {
          await markWhatsappError(lastError);
        }
        throw error;
      }

      return;
    }

    if (job.name === RESET_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, RESET_WHATSAPP_JOB);
      console.log("[worker] reset-whatsapp job received", { instanceId });

      try {
        await clearWhatsappOperationalData("manual-reset-worker", instanceId);
        await resetWhatsappInstance(instanceId);
        console.log("[worker] reset-whatsapp finished", { instanceId });
      } catch (error) {
        const lastError = `Falha ao resetar sessao WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] reset-whatsapp failed", { instanceId, error: lastError });
        if (instanceId === DEFAULT_WHATSAPP_INSTANCE_ID) {
          await markWhatsappError(lastError);
        }
        throw error;
      }

      return;
    }

    if (job.name === SYNC_WHATSAPP_HISTORY_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, SYNC_WHATSAPP_HISTORY_JOB);
      console.log("[worker] sync-whatsapp-history job received", { instanceId });

      const result = await requestWhatsappHistorySync();
      console.log("[worker] sync-whatsapp-history finished", {
        instanceId,
        ok: result.ok,
        mode: result.mode
      });

      return;
    }

    if (job.name === SYNC_WHATSAPP_CATALOG_JOB) {
      const data = job.data as Partial<SyncWhatsappCatalogJobData>;
      const instanceId = getRequiredJobInstanceId(data, SYNC_WHATSAPP_CATALOG_JOB);
      console.log("[worker] sync-whatsapp-catalog job received", { instanceId });

      const result = await requestWhatsappCatalogSyncForInstance(instanceId, data);
      console.log("[worker] sync-whatsapp-catalog finished", {
        instanceId,
        ok: result.ok,
        mode: result.mode
      });

      return;
    }

    if (job.name === APPLY_WHATSAPP_LABELS_JOB) {
      const data = job.data as Partial<ApplyWhatsappLabelsJobData>;
      const jids = Array.isArray(data.jids) ? data.jids : [];
      const waLabelId = String(data.waLabelId ?? "").trim();
      const instanceId = getRequiredJobInstanceId(data, APPLY_WHATSAPP_LABELS_JOB);

      console.log("[contacts-labels] apply requested", {
        instanceId,
        count: jids.length
      });

      if (!waLabelId || jids.length === 0) {
        console.log("[contacts-labels] skipped no chat", {
          count: jids.length
        });
        return;
      }

      const result = await applyWhatsappLabelsForInstance({
        instanceId,
        waLabelId,
        jids
      });

      console.log("[contacts-labels] apply finished", {
        ok: result.ok,
        applied: result.applied,
        skipped: result.skipped,
        failed: result.failed
      });

      return;
    }

    if (job.name === SEND_MANUAL_MESSAGE_JOB) {
      await processManualMessage(job.data as Partial<SendManualMessageJobData>, job.id);
      return;
    }

    if (job.name !== SEND_RECIPIENT_JOB) {
      return;
    }

    const recipientId = String(job.data?.recipientId ?? "");

    if (!recipientId) {
      return;
    }

    await processRecipient(recipientId);
  },
  {
    connection: redisConnectionOptions,
    concurrency: 1
  }
);

worker.on("failed", (job, error) => {
  console.error("[worker] sender-worker job failed", {
    jobId: job?.id,
    jobName: job?.name,
    error: error.message
  });
});

process.on("SIGTERM", () => {
  void worker.close().then(() => process.exit(0));
});

process.on("SIGINT", () => {
  void worker.close().then(() => process.exit(0));
});
