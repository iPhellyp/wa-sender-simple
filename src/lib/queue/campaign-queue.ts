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

export type SyncJobEnqueueResult = {
  jobId: string | null;
  deduped: boolean;
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

function requireInstanceId(instanceId: string | undefined, jobName: string) {
  const normalizedInstanceId = String(instanceId ?? "").trim();

  if (!normalizedInstanceId) {
    throw new Error(`${jobName} requires instanceId`);
  }

  return normalizedInstanceId;
}

export function getCampaignQueue() {
  if (!queue) {
    queue = new Queue(CAMPAIGN_QUEUE_NAME, {
      connection: getRedisConnectionOptions()
    });
  }

  return queue;
}

export async function closeCampaignQueue() {
  if (!queue) return;
  const activeQueue = queue;
  queue = null;
  await activeQueue.close();
}

async function removeStaleJob(jobId: string) {
  const job = await getCampaignQueue().getJob(jobId);

  if (!job) {
    return;
  }

  const state = await job.getState();

  if (state === "active") {
    return;
  }

  await job.remove().catch(() => undefined);
}

async function enqueueDedupedSyncJob(
  jobName: string,
  jobId: string,
  data: Record<string, unknown>
): Promise<SyncJobEnqueueResult> {
  const existingJob = await getCampaignQueue().getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();

    if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) {
      return {
        jobId: existingJob.id ?? jobId,
        deduped: true
      };
    }

    await existingJob.remove().catch(() => undefined);
  }

  const job = await getCampaignQueue().add(jobName, data, {
    attempts: 1,
    jobId,
    removeOnComplete: true,
    removeOnFail: 100
  });

  return {
    jobId: job.id ?? null,
    deduped: false
  };
}

export async function enqueueRecipient(recipientId: string, delayMs: number): Promise<SyncJobEnqueueResult> {
  const safeDelay = Math.max(0, delayMs);
  const jobId = buildJobId("recipient", recipientId);
  const existingJob = await getCampaignQueue().getJob(jobId);

  if (existingJob) {
    const state = await existingJob.getState();

    if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) {
      return {
        jobId: existingJob.id ?? jobId,
        deduped: true
      };
    }

    await existingJob.remove().catch(() => undefined);
  }

  const job = await getCampaignQueue().add(
    SEND_RECIPIENT_JOB,
    { recipientId },
    {
      delay: safeDelay,
      attempts: 1,
      jobId,
      removeOnComplete: true,
      removeOnFail: 5000
    }
  );

  return {
    jobId: job.id ?? jobId,
    deduped: false
  };
}

export async function enqueueWhatsappConnect(instanceId: string) {
  const normalizedInstanceId = requireInstanceId(instanceId, CONNECT_WHATSAPP_JOB);
  const jobId = buildJobId(CONNECT_WHATSAPP_JOB, normalizedInstanceId);
  await removeStaleJob(jobId);
  await getCampaignQueue().add(
    CONNECT_WHATSAPP_JOB,
    { instanceId: normalizedInstanceId },
    {
      attempts: 1,
      jobId,
      removeOnComplete: true,
      removeOnFail: 100
    }
  );
}

export async function enqueueWhatsappDisconnect(instanceId: string) {
  const normalizedInstanceId = requireInstanceId(instanceId, DISCONNECT_WHATSAPP_JOB);
  const jobId = buildJobId(DISCONNECT_WHATSAPP_JOB, normalizedInstanceId);
  await removeStaleJob(jobId);
  const job = await getCampaignQueue().add(
    DISCONNECT_WHATSAPP_JOB,
    { instanceId: normalizedInstanceId },
    {
      attempts: 1,
      jobId,
      removeOnComplete: true,
      removeOnFail: 100
    }
  );

  return job.id ?? null;
}

export async function enqueueWhatsappReset(instanceId: string) {
  const normalizedInstanceId = requireInstanceId(instanceId, RESET_WHATSAPP_JOB);
  const jobId = buildJobId(RESET_WHATSAPP_JOB, normalizedInstanceId);
  await removeStaleJob(jobId);
  const job = await getCampaignQueue().add(
    RESET_WHATSAPP_JOB,
    { instanceId: normalizedInstanceId },
    {
      attempts: 1,
      jobId,
      removeOnComplete: true,
      removeOnFail: 100
    }
  );

  return job.id ?? null;
}

export async function enqueueManualMessage(data: SendManualMessageJobData) {
  const instanceId = requireInstanceId(data.instanceId, SEND_MANUAL_MESSAGE_JOB);
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

export async function enqueueWhatsappHistorySync(instanceId: string): Promise<SyncJobEnqueueResult> {
  const normalizedInstanceId = requireInstanceId(instanceId, SYNC_WHATSAPP_HISTORY_JOB);
  return enqueueDedupedSyncJob(
    SYNC_WHATSAPP_HISTORY_JOB,
    buildJobId(SYNC_WHATSAPP_HISTORY_JOB, "quick", normalizedInstanceId),
    { instanceId: normalizedInstanceId }
  );
}

export async function enqueueWhatsappCatalogSync(data: SyncWhatsappCatalogJobData = {}): Promise<SyncJobEnqueueResult> {
  const instanceId = requireInstanceId(data.instanceId, SYNC_WHATSAPP_CATALOG_JOB);
  const syncType = data.forceSnapshot === true ? "full" : "quick";
  return enqueueDedupedSyncJob(
    SYNC_WHATSAPP_CATALOG_JOB,
    buildJobId(SYNC_WHATSAPP_CATALOG_JOB, syncType, instanceId),
    {
      ...data,
      instanceId
    }
  );
}

export async function enqueueApplyWhatsappLabels(data: ApplyWhatsappLabelsJobData) {
  const instanceId = requireInstanceId(data.instanceId, APPLY_WHATSAPP_LABELS_JOB);
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
