import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./connection";

export const CAMPAIGN_QUEUE_NAME = "campaign-sender";
export const SEND_RECIPIENT_JOB = "send-recipient";
export const CONNECT_WHATSAPP_JOB = "connect-whatsapp";
export const DISCONNECT_WHATSAPP_JOB = "disconnect-whatsapp";
export const RESET_WHATSAPP_JOB = "reset-whatsapp";
export const SEND_MANUAL_MESSAGE_JOB = "send-manual-message";

export type SendManualMessageJobData = {
  chatId: string;
  jid: string;
  text: string;
};

let queue: Queue | null = null;

function safeJobIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
}

function buildJobId(...parts: string[]) {
  return parts.map(safeJobIdPart).filter(Boolean).join("-");
}

export function getCampaignQueue() {
  if (!queue) {
    queue = new Queue(CAMPAIGN_QUEUE_NAME, {
      connection: getRedisConnectionOptions()
    });
  }

  return queue;
}

export async function enqueueRecipient(recipientId: string, delayMs: number, jobKey?: string) {
  const safeDelay = Math.max(0, delayMs);

  await getCampaignQueue().add(
    SEND_RECIPIENT_JOB,
    { recipientId },
    {
      delay: safeDelay,
      attempts: 1,
      jobId: buildJobId("recipient", recipientId, jobKey ?? `${Date.now()}-${safeDelay}`),
      removeOnComplete: true,
      removeOnFail: 5000
    }
  );
}

export async function enqueueWhatsappConnect() {
  await getCampaignQueue().add(
    CONNECT_WHATSAPP_JOB,
    {},
    {
      attempts: 1,
      jobId: buildJobId("connect-whatsapp", String(Date.now())),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueWhatsappDisconnect() {
  await getCampaignQueue().add(
    DISCONNECT_WHATSAPP_JOB,
    {},
    {
      attempts: 1,
      jobId: buildJobId("disconnect-whatsapp", String(Date.now())),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueWhatsappReset() {
  await getCampaignQueue().add(
    RESET_WHATSAPP_JOB,
    {},
    {
      attempts: 1,
      jobId: buildJobId("reset-whatsapp", String(Date.now())),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueManualMessage(data: SendManualMessageJobData) {
  const job = await getCampaignQueue().add(
    SEND_MANUAL_MESSAGE_JOB,
    data,
    {
      attempts: 1,
      jobId: buildJobId("manual-send", data.chatId, String(Date.now())),
      removeOnComplete: true,
      removeOnFail: 1000
    }
  );

  return job.id ?? null;
}
