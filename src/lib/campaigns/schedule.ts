import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../prisma/client";
import { enqueueRecipient } from "../queue/campaign-queue";
import { completeCampaignIfDone } from "./progress";
import { getDispatchDay, nextDispatchDecision, resolveDispatchSettings } from "./dispatch-policy";

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
    await prisma.campaign.updateMany({
      where: { id: campaignId, instanceId: campaign.instanceId, status: CampaignStatus.running },
      data: { nextDispatchAt: scheduledRecipient.scheduledAt }
    });
    await enqueueRecipient(
      scheduledRecipient.id,
      Math.max(0, (scheduledRecipient.scheduledAt?.getTime() ?? Date.now()) - Date.now())
    );
    return;
  }

  const now = new Date();
  const settings = resolveDispatchSettings(campaign.dispatchConfig, campaign.sendWindowStart);
  let sentToday = sentCount;

  if (Number.isInteger(settings.dailyLimit) && Number(settings.dailyLimit) > 0) {
    const day = getDispatchDay(now, settings);
    sentToday = await prisma.campaignRecipient.count({
      where: {
        instanceId: campaign.instanceId,
        campaignId,
        status: CampaignRecipientStatus.sent,
        sentAt: { gte: day.dayStart, lt: day.dayEnd }
      }
    });
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

    const decision = nextDispatchDecision({
      now,
      settings,
      fallbackDelayMs: delayMs,
      sentToday,
      sentInCycle: sentCount,
      hasPending: true
    });

    if (decision.pauseCampaign || !decision.nextAt) {
      await prisma.campaign.updateMany({
        where: { id: campaignId, instanceId: campaign.instanceId, status: CampaignStatus.running },
        data: { status: CampaignStatus.paused, nextDispatchAt: null, lastError: "Campanha pausada ao final da janela diaria" }
      });
      return;
    }

    const scheduledAt = decision.nextAt;
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
      await prisma.campaign.updateMany({
        where: { id: campaignId, instanceId: campaign.instanceId, status: CampaignStatus.running },
        data: { nextDispatchAt: scheduledAt }
      });
      await enqueueRecipient(recipient.id, scheduledAt.getTime() - Date.now());
    }

    return;
  }

  await prisma.campaign.updateMany({
    where: { id: campaignId, instanceId: campaign.instanceId },
    data: { nextDispatchAt: null }
  });
  await completeCampaignIfDone(campaignId);
}
