import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "../prisma/client";

const openRecipientStatuses: CampaignRecipientStatus[] = [
  CampaignRecipientStatus.pending,
  CampaignRecipientStatus.scheduled,
  CampaignRecipientStatus.sending
];

export async function completeCampaignIfDone(campaignId: string) {
  const remainingRecipients = await prisma.campaignRecipient.count({
    where: {
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
      status: CampaignStatus.running
    },
    data: {
      status: CampaignStatus.completed,
      completedAt: new Date()
    }
  });
}
