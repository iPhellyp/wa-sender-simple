import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../prisma/client";
import { enqueueRecipient } from "../queue/campaign-queue";
import { completeCampaignIfDone } from "./progress";

const blockingRecipientStatuses: CampaignRecipientStatus[] = [
  CampaignRecipientStatus.scheduled,
  CampaignRecipientStatus.sending
];

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

  const alreadyScheduledOrSending = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      status: {
        in: blockingRecipientStatuses
      }
    }
  });

  if (alreadyScheduledOrSending > 0) {
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

    const scheduledAt = new Date(Date.now() + Math.max(0, delayMs));
    const updatedRecipient = await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        status: CampaignRecipientStatus.pending
      },
      data: {
        status: CampaignRecipientStatus.scheduled,
        scheduledAt,
        error: null
      }
    });

    if (updatedRecipient.count > 0) {
      await enqueueRecipient(
        recipient.id,
        scheduledAt.getTime() - Date.now(),
        String(scheduledAt.getTime())
      );
    }

    return;
  }

  await completeCampaignIfDone(campaignId);
}
