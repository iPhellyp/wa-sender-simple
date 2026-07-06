import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./connection";

export const CAMPAIGN_QUEUE_NAME = "campaign-sender";
export const SEND_RECIPIENT_JOB = "send-recipient";
export const CONNECT_WHATSAPP_JOB = "connect-whatsapp";
export const DISCONNECT_WHATSAPP_JOB = "disconnect-whatsapp";

let queue: Queue | null = null;

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
      jobId: `recipient:${recipientId}:${jobKey ?? `${Date.now()}:${safeDelay}`}`,
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
      jobId: `connect-whatsapp:${Date.now()}`,
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
      jobId: `disconnect-whatsapp:${Date.now()}`,
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}
