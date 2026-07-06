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
  enqueueRecipient,
  type SendManualMessageJobData
} from "../lib/queue/campaign-queue";
import { getRedisConnectionOptions } from "../lib/queue/connection";
import {
  disconnectBaileys,
  markWhatsappError,
  resetBaileysSession,
  sendWhatsappMessage,
  sendWhatsappMessageToJid,
  startBaileysConnection
} from "../lib/baileys/client";
import { isGroupJid, normalizeChatJid } from "../lib/baileys/sync";
import { completeCampaignIfDone } from "../lib/campaigns/progress";
import { schedulePendingRecipients } from "../lib/campaigns/schedule";

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

function buildManualFallbackMessageId(jobId: string | undefined) {
  return `manual-${jobId ?? Date.now()}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 180);
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
    const waMessageId = sentMessage.waMessageId ?? buildManualFallbackMessageId(jobId);

    await prisma.whatsappMessage.upsert({
      where: {
        jid_waMessageId: {
          jid: normalizedJid,
          waMessageId
        }
      },
      update: {
        chatId,
        fromMe: true,
        senderJid: sentMessage.senderJid,
        timestamp: sentAt,
        messageType: "text",
        text,
        rawJson: sentMessage.rawJson
      },
      create: {
        chatId,
        jid: normalizedJid,
        waMessageId,
        fromMe: true,
        senderJid: sentMessage.senderJid,
        timestamp: sentAt,
        messageType: "text",
        text,
        rawJson: sentMessage.rawJson
      }
    });

    await prisma.whatsappChat.update({
      where: {
        id: chatId
      },
      data: {
        isGroup: isGroupJid(normalizedJid),
        lastMessageAt: sentAt,
        lastMessageText: text,
        lastOutboundAt: sentAt
      }
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

  if (recipient.contact.optedOut) {
    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Contato opt-out"
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
      error: null
    }
  });

  try {
    await sendWhatsappMessage(recipient.contact.phoneNormalized, recipient.messageFinal);

    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.sent,
        sentAt: new Date(),
        error: null
      }
    });
  } catch (error) {
    await prisma.campaignRecipient.update({
      where: {
        id: recipient.id
      },
      data: {
        status: CampaignRecipientStatus.failed,
        error: error instanceof Error ? error.message : "Erro ao enviar mensagem"
      }
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
        console.log("[worker] connect-whatsapp started");
      } catch (error) {
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
