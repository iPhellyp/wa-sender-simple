import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../prisma/client";
import { completeCampaignIfDone } from "./progress";
import { schedulePendingRecipients } from "./schedule";
import { startCampaign } from "./start-campaign";

const DEFAULT_SCAN_INTERVAL_MS = 15_000;
const STUCK_SENDING_THRESHOLD_MS = 10 * 60 * 1000;
const reportedStuckRecipients = new Set<string>();

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

async function reconcileDueCampaigns(now: Date) {
  const dueCampaigns = await prisma.campaign.findMany({
    where: {
      status: CampaignStatus.scheduled,
      scheduledAt: {
        lte: now
      }
    },
    orderBy: {
      scheduledAt: "asc"
    },
    take: 100,
    select: {
      id: true,
      instanceId: true
    }
  });

  for (const campaign of dueCampaigns) {
    try {
      const result = await startCampaign({
        campaignId: campaign.id,
        instanceId: campaign.instanceId,
        origin: "SCHEDULER"
      });

      if (result.started) {
        console.log("[campaign-scheduler] campaign started", {
          campaignId: campaign.id,
          instanceId: campaign.instanceId
        });
      }
    } catch (error) {
      console.error("[campaign-scheduler] scheduled campaign failed", {
        campaignId: campaign.id,
        instanceId: campaign.instanceId,
        error: getErrorMessage(error)
      });
    }
  }
}

async function reconcileRunningCampaigns() {
  const runningCampaigns = await prisma.campaign.findMany({
    where: {
      status: CampaignStatus.running
    },
    orderBy: {
      updatedAt: "asc"
    },
    take: 200,
    select: {
      id: true,
      instanceId: true
    }
  });

  for (const campaign of runningCampaigns) {
    try {
      await schedulePendingRecipients(campaign.id);
      await completeCampaignIfDone(campaign.id);
      await prisma.campaign.updateMany({
        where: {
          id: campaign.id,
          instanceId: campaign.instanceId,
          status: CampaignStatus.running
        },
        data: {
          lastError: null
        }
      });
    } catch (error) {
      console.error("[campaign-scheduler] running campaign reconciliation failed", {
        campaignId: campaign.id,
        instanceId: campaign.instanceId,
        error: getErrorMessage(error)
      });
    }
  }
}

async function reportStuckRecipients(now: Date) {
  const stuckRecipients = await prisma.campaignRecipient.findMany({
    where: {
      status: CampaignRecipientStatus.sending,
      lastAttemptAt: {
        lt: new Date(now.getTime() - STUCK_SENDING_THRESHOLD_MS)
      }
    },
    orderBy: {
      lastAttemptAt: "asc"
    },
    take: 100,
    select: {
      id: true,
      campaignId: true,
      instanceId: true,
      lastAttemptAt: true
    }
  });
  const currentStuckIds = new Set(stuckRecipients.map((recipient) => recipient.id));

  for (const recipientId of reportedStuckRecipients) {
    if (!currentStuckIds.has(recipientId)) reportedStuckRecipients.delete(recipientId);
  }

  for (const recipient of stuckRecipients) {
    if (reportedStuckRecipients.has(recipient.id)) continue;
    reportedStuckRecipients.add(recipient.id);
    console.error("[campaign-scheduler] recipient stuck in sending; manual review required", {
      recipientId: recipient.id,
      campaignId: recipient.campaignId,
      instanceId: recipient.instanceId,
      lastAttemptAt: recipient.lastAttemptAt?.toISOString() ?? null
    });
  }
}

export async function reconcileCampaignRuntime() {
  const now = new Date();
  await reconcileDueCampaigns(now);
  await reconcileRunningCampaigns();
  await reportStuckRecipients(now);
}

export function startCampaignScheduler(intervalMs = DEFAULT_SCAN_INTERVAL_MS) {
  let stopped = false;
  let runningScan: Promise<void> | null = null;

  const scan = () => {
    if (stopped || runningScan) return;

    runningScan = reconcileCampaignRuntime()
      .catch((error) => {
        console.error("[campaign-scheduler] scan failed", {
          error: getErrorMessage(error)
        });
      })
      .finally(() => {
        runningScan = null;
      });
  };

  scan();
  const timer = setInterval(scan, intervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await runningScan;
    }
  };
}
