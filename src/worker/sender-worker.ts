import { Worker } from "bullmq";
import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../lib/prisma/client";
import {
  CAMPAIGN_QUEUE_NAME,
  CONNECT_WHATSAPP_JOB,
  DISCONNECT_WHATSAPP_JOB,
  RESET_WHATSAPP_JOB,
  SEND_MANUAL_MESSAGE_JOB,
  SEND_RECIPIENT_JOB,
  SYNC_WHATSAPP_CATALOG_JOB,
  SYNC_WHATSAPP_HISTORY_JOB,
  enqueueRecipient,
  type SendManualMessageJobData
} from "../lib/queue/campaign-queue";
import { getRedisConnectionOptions } from "../lib/queue/connection";
import {
  disconnectBaileys,
  isBaileysStartSkippedError,
  markWhatsappError,
  requestWhatsappCatalogSync,
  requestWhatsappHistorySync,
  resetBaileysSession,
  sendWhatsappMessage,
  sendWhatsappMessageToJid,
  startBaileysConnection
} from "../lib/baileys/client";
import { ensureChatForJid, isGroupJid, normalizeChatJid } from "../lib/baileys/sync";
import { completeCampaignIfDone } from "../lib/campaigns/progress";
import { schedulePendingRecipients } from "../lib/campaigns/schedule";
import { hashMessage, resolveCampaignJid, type SkippedReason } from "../lib/labels/audience";
import { normalizeBrazilPhone, toWhatsappJid } from "../lib/phone/normalize";
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

async function requeueRecipient(recipientId: string, delayMs = PAUSED_RECHECK_DELAY_MS) {
  await enqueueRecipient(recipientId, delayMs);
}

type SentWhatsappMessage = Awaited<ReturnType<typeof sendWhatsappMessageToJid>>;

function buildFallbackMessageId(prefix: string, id: string | undefined) {
  return `${prefix}-${id ?? Date.now()}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 180);
}

async function persistOutboundMessage(options: {
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
    throw new Error("JID ignorado pelo modo X1");
  }

  const chat = await ensureChatForJid(normalizedJid);
  const waMessageId = options.sentMessage.waMessageId ?? options.fallbackMessageId;

  await prisma.whatsappMessage.upsert({
    where: {
      jid_waMessageId: {
        jid: normalizedJid,
        waMessageId
      }
    },
    update: {
      chatId: chat.id,
      fromMe: true,
      senderJid: options.sentMessage.senderJid,
      timestamp: options.sentAt,
      messageType: "text",
      text: options.text,
      rawJson: options.sentMessage.rawJson
    },
    create: {
      chatId: chat.id,
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
      id: chat.id
    },
    data: {
      isGroup: isGroupJid(normalizedJid),
      lastMessageAt: options.sentAt,
      lastMessageText: options.text,
      lastOutboundAt: options.sentAt
    }
  });

  return chat.id;
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

  const contact = await prisma.contact.findUnique({
    where: {
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
    return "Grupo ignorado pelo modo X1";
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
  jid: string | null;
  chatId: string | null;
}) {
  if (recipient.jid) {
    return resolveCampaignJid([recipient.jid]);
  }

  if (!recipient.chatId) {
    return resolveCampaignJid([]);
  }

  const chat = await prisma.whatsappChat.findUnique({
    where: {
      id: recipient.chatId
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

  if (!chatId) {
    throw new Error("chatId obrigatorio para envio manual");
  }

  if (!normalizedJid) {
    throw new Error("JID invalido para envio manual");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("Envio manual para grupo ignorado pelo modo X1");
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

  if (chat.jid !== normalizedJid) {
    throw new Error("JID do job nao corresponde a conversa");
  }

  try {
    const sentMessage = await sendWhatsappMessageToJid(normalizedJid, text);
    const sentAt = new Date();
    await persistOutboundMessage({
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
      sentMessage = await sendWhatsappMessageToJid(resolvedRecipientJid, recipient.messageFinal);
    } else if (recipient.contact) {
      sentJid = toWhatsappJid(recipient.contact.phoneNormalized);
      sentMessage = await sendWhatsappMessage(recipient.contact.phoneNormalized, recipient.messageFinal);
    } else {
      throw new Error("Destinatario sem jid ou contato");
    }

    const sentAt = new Date();
    const persistedChatId = await persistOutboundMessage({
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
      console.log("[worker] connect-whatsapp job received");

      try {
        await startBaileysConnection();
        console.log("[worker] connect-whatsapp finished");
      } catch (error) {
        if (isBaileysStartSkippedError(error)) {
          console.log("[worker] connect-whatsapp skipped", {
            reason: getErrorMessage(error)
          });
          return;
        }

        const lastError = `Falha ao iniciar conexao WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] connect-whatsapp failed", { error: lastError });
        await markWhatsappError(lastError);
        throw error;
      }

      return;
    }

    if (job.name === DISCONNECT_WHATSAPP_JOB) {
      console.log("[worker] disconnect-whatsapp job received");

      try {
        await disconnectBaileys();
        console.log("[worker] disconnect-whatsapp finished");
      } catch (error) {
        const lastError = `Falha ao desconectar WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] disconnect-whatsapp failed", { error: lastError });
        await markWhatsappError(lastError);
        throw error;
      }

      return;
    }

    if (job.name === RESET_WHATSAPP_JOB) {
      console.log("[worker] reset-whatsapp job received");

      try {
        await resetBaileysSession();
        console.log("[worker] reset-whatsapp finished");
      } catch (error) {
        const lastError = `Falha ao resetar sessao WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] reset-whatsapp failed", { error: lastError });
        await markWhatsappError(lastError);
        throw error;
      }

      return;
    }

    if (job.name === SYNC_WHATSAPP_HISTORY_JOB) {
      console.log("[worker] sync-whatsapp-history job received");

      const result = await requestWhatsappHistorySync();
      console.log("[worker] sync-whatsapp-history finished", {
        ok: result.ok,
        mode: result.mode
      });

      return;
    }

    if (job.name === SYNC_WHATSAPP_CATALOG_JOB) {
      console.log("[worker] sync-whatsapp-catalog job received");

      const result = await requestWhatsappCatalogSync();
      console.log("[worker] sync-whatsapp-catalog finished", {
        ok: result.ok,
        mode: result.mode
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
