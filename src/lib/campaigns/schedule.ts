import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../prisma/client";
import { enqueueRecipient } from "../queue/campaign-queue";
import { completeCampaignIfDone } from "./progress";

type AdvancedCampaignSettings = {
  delayMode?: "fixed_seconds" | "fixed_minutes" | "random_range";
  fixedSeconds?: number;
  fixedMinutes?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  pauseEvery?: number;
  pauseMinutes?: number;
  batchLimit?: number;
};

function parseAdvancedSettings(value: string | null): AdvancedCampaignSettings {
  if (!value?.startsWith("settings:")) {
    return {};
  }

  try {
    const parsed = JSON.parse(value.slice("settings:".length)) as AdvancedCampaignSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getNormalDelayMs(settings: AdvancedCampaignSettings, fallbackDelayMs: number, intervalMinutes: number) {
  if (settings.delayMode === "fixed_seconds" && Number.isFinite(settings.fixedSeconds)) {
    return Math.max(0, Number(settings.fixedSeconds) * 1000);
  }

  if (settings.delayMode === "fixed_minutes" && Number.isFinite(settings.fixedMinutes)) {
    return Math.max(0, Number(settings.fixedMinutes) * 60 * 1000);
  }

  if (
    settings.delayMode === "random_range" &&
    Number.isFinite(settings.minDelaySeconds) &&
    Number.isFinite(settings.maxDelaySeconds)
  ) {
    const min = Math.max(0, Number(settings.minDelaySeconds));
    const max = Math.max(min, Number(settings.maxDelaySeconds));
    return Math.round((min + Math.random() * (max - min)) * 1000);
  }

  return Math.max(0, fallbackDelayMs || intervalMinutes * 60 * 1000);
}

function getNextDelayMs(params: {
  settings: AdvancedCampaignSettings;
  fallbackDelayMs: number;
  intervalMinutes: number;
  sentCount: number;
}) {
  if (params.sentCount === 0) {
    return Math.max(0, params.fallbackDelayMs);
  }

  const pauseEvery = Number(params.settings.pauseEvery ?? 0);

  if (
    Number.isInteger(pauseEvery) &&
    pauseEvery > 0 &&
    params.sentCount > 0 &&
    params.sentCount % pauseEvery === 0
  ) {
    const pauseMinutes = Math.max(1, Number(params.settings.pauseMinutes ?? 1));
    return pauseMinutes * 60 * 1000;
  }

  return getNormalDelayMs(params.settings, params.fallbackDelayMs, params.intervalMinutes);
}

export async function schedulePendingRecipients(campaignId: string, delayMs = 0) {
  const campaign = await prisma.campaign.findUnique({
    where: {
      id: campaignId
    },
    include: {
      recipients: {
        where: {
          status: CampaignRecipientStatus.pending
        },
        include: {
          contact: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!campaign || campaign.status !== CampaignStatus.running) {
    return;
  }

  const sentCount = await prisma.campaignRecipient.count({
    where: {
      instanceId: campaign.instanceId,
      campaignId,
      status: CampaignRecipientStatus.sent
    }
  });
  const sendingRecipientCount = await prisma.campaignRecipient.count({
    where: {
      instanceId: campaign.instanceId,
      campaignId,
      status: CampaignRecipientStatus.sending
    }
  });

  if (sendingRecipientCount > 0) {
    return;
  }

  const scheduledRecipient = await prisma.campaignRecipient.findFirst({
    where: {
      instanceId: campaign.instanceId,
      campaignId,
      status: CampaignRecipientStatus.scheduled
    },
    orderBy: [
      {
        scheduledAt: "asc"
      },
      {
        createdAt: "asc"
      }
    ],
    select: {
      id: true,
      scheduledAt: true
    }
  });

  if (scheduledRecipient) {
    await enqueueRecipient(
      scheduledRecipient.id,
      Math.max(0, (scheduledRecipient.scheduledAt?.getTime() ?? Date.now()) - Date.now())
    );
    return;
  }

  for (const recipient of campaign.recipients) {
    const optedOut = recipient.contact
      ? recipient.contact.optedOut
      : false;

    if (optedOut) {
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
      continue;
    }

    const scheduledDelayMs = getNextDelayMs({
      settings: parseAdvancedSettings(campaign.sendWindowStart),
      fallbackDelayMs: delayMs,
      intervalMinutes: campaign.intervalMinutes,
      sentCount
    });
    const scheduledAt = new Date(Date.now() + scheduledDelayMs);
    const updatedRecipient = await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: campaign.instanceId,
        status: CampaignRecipientStatus.pending
      },
      data: {
        status: CampaignRecipientStatus.scheduled,
        scheduledAt,
        error: null
      }
    });

    if (updatedRecipient.count > 0) {
      await enqueueRecipient(recipient.id, scheduledAt.getTime() - Date.now());
    }

    return;
  }

  await completeCampaignIfDone(campaignId);
}
