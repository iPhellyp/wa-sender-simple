import { Worker } from "bullmq";
import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../lib/prisma/client";
import {
  CAMPAIGN_QUEUE_NAME,
  CONNECT_WHATSAPP_JOB,
  DISCONNECT_WHATSAPP_JOB,
  SEND_RECIPIENT_JOB,
  enqueueRecipient
} from "../lib/queue/campaign-queue";
import { getRedisConnectionOptions } from "../lib/queue/connection";
import {
  disconnectBaileys,
  sendWhatsappMessage,
  startBaileysConnection
} from "../lib/baileys/client";
import { completeCampaignIfDone } from "../lib/campaigns/progress";
import { schedulePendingRecipients } from "../lib/campaigns/schedule";

const PAUSED_RECHECK_DELAY_MS = 60 * 1000;
const finalRecipientStatuses: CampaignRecipientStatus[] = [
  CampaignRecipientStatus.sent,
  CampaignRecipientStatus.failed,
  CampaignRecipientStatus.canceled
];

async function requeueRecipient(recipientId: string, delayMs = PAUSED_RECHECK_DELAY_MS) {
  await enqueueRecipient(recipientId, delayMs);
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
    if (job.name === CONNECT_WHATSAPP_JOB) {
      await startBaileysConnection();
      return;
    }

    if (job.name === DISCONNECT_WHATSAPP_JOB) {
      await disconnectBaileys();
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
    connection: getRedisConnectionOptions(),
    concurrency: 1
  }
);

worker.on("failed", (job, error) => {
  console.error("sender-worker job failed", {
    jobId: job?.id,
    error: error.message
  });
});

process.on("SIGTERM", () => {
  void worker.close().then(() => process.exit(0));
});

process.on("SIGINT", () => {
  void worker.close().then(() => process.exit(0));
});
