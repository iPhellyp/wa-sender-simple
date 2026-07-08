import { Queue } from "bullmq";
import { getRedisConnectionOptions } from "./connection";

export const CAMPAIGN_QUEUE_NAME = "campaign-sender";
export const SEND_RECIPIENT_JOB = "send-recipient";
export const CONNECT_WHATSAPP_JOB = "connect-whatsapp";
export const DISCONNECT_WHATSAPP_JOB = "disconnect-whatsapp";
export const RESET_WHATSAPP_JOB = "reset-whatsapp";
export const SEND_MANUAL_MESSAGE_JOB = "send-manual-message";
export const SYNC_WHATSAPP_HISTORY_JOB = "sync-whatsapp-history";
export const SYNC_WHATSAPP_CATALOG_JOB = "sync-whatsapp-catalog";
export const APPLY_WHATSAPP_LABELS_JOB = "apply-whatsapp-labels";

const SYNC_WHATSAPP_HISTORY_JOB_ID = "sync-whatsapp-history";

type InstanceJobData = {
  instanceId?: string;
};

export type SendManualMessageJobData = InstanceJobData & {
  chatId: string;
  jid: string;
  text: string;
};

export type SyncWhatsappCatalogJobData = InstanceJobData & {
  forceSnapshot?: boolean;
};

export type ApplyWhatsappLabelsJobData = InstanceJobData & {
  requestId: string;
  labelId: string;
  waLabelId: string;
  jids: string[];
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

export async function enqueueWhatsappConnect(instanceId = "default") {
  await getCampaignQueue().add(
    CONNECT_WHATSAPP_JOB,
    { instanceId },
    {
      attempts: 1,
      jobId: buildJobId(CONNECT_WHATSAPP_JOB, instanceId),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueWhatsappDisconnect(instanceId = "default") {
  await getCampaignQueue().add(
    DISCONNECT_WHATSAPP_JOB,
    { instanceId },
    {
      attempts: 1,
      jobId: buildJobId(DISCONNECT_WHATSAPP_JOB, instanceId),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueWhatsappReset(instanceId = "default") {
  await getCampaignQueue().add(
    RESET_WHATSAPP_JOB,
    { instanceId },
    {
      attempts: 1,
      jobId: buildJobId(RESET_WHATSAPP_JOB, instanceId),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueManualMessage(data: SendManualMessageJobData) {
  const instanceId = data.instanceId ?? "default";
  const job = await getCampaignQueue().add(
    SEND_MANUAL_MESSAGE_JOB,
    {
      ...data,
      instanceId
    },
    {
      attempts: 1,
      jobId: buildJobId("manual-send", instanceId, data.chatId, String(Date.now())),
      removeOnComplete: true,
      removeOnFail: 1000
    }
  );

  return job.id ?? null;
}

export async function enqueueWhatsappHistorySync() {
  const job = await getCampaignQueue().add(
    SYNC_WHATSAPP_HISTORY_JOB,
    {},
    {
      attempts: 1,
      jobId: SYNC_WHATSAPP_HISTORY_JOB_ID,
      removeOnComplete: true,
      removeOnFail: 100
    }
  );

  return job.id ?? null;
}

export async function enqueueWhatsappCatalogSync(data: SyncWhatsappCatalogJobData = {}) {
  const instanceId = data.instanceId ?? "default";
  const job = await getCampaignQueue().add(
    SYNC_WHATSAPP_CATALOG_JOB,
    {
      ...data,
      instanceId
    },
    {
      attempts: 1,
      jobId: buildJobId(SYNC_WHATSAPP_CATALOG_JOB, instanceId),
      removeOnComplete: true,
      removeOnFail: 100
    }
  );

  return job.id ?? null;
}

export async function enqueueApplyWhatsappLabels(data: ApplyWhatsappLabelsJobData) {
  const instanceId = data.instanceId ?? "default";
  const job = await getCampaignQueue().add(
    APPLY_WHATSAPP_LABELS_JOB,
    {
      ...data,
      instanceId
    },
    {
      attempts: 1,
      jobId: buildJobId("apply-labels", instanceId, data.requestId),
      removeOnComplete: true,
      removeOnFail: 1000
    }
  );

  return job.id ?? null;
}
