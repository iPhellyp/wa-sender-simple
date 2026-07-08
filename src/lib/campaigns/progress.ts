import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../prisma/client";

const openRecipientStatuses: CampaignRecipientStatus[] = [
  CampaignRecipientStatus.pending,
  CampaignRecipientStatus.scheduled,
  CampaignRecipientStatus.sending
];

export async function completeCampaignIfDone(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: {
      id: campaignId
    },
    select: {
      instanceId: true
    }
  });

  if (!campaign) {
    return;
  }

  const remainingRecipients = await prisma.campaignRecipient.count({
    where: {
      instanceId: campaign.instanceId,
      campaignId,
      status: {
        in: openRecipientStatuses
      }
    }
  });

  if (remainingRecipients > 0) {
    return;
  }

  await prisma.campaign.updateMany({
    where: {
      id: campaignId,
      instanceId: campaign.instanceId,
      status: CampaignStatus.running
    },
    data: {
      status: CampaignStatus.completed,
      completedAt: new Date()
    }
  });
}
