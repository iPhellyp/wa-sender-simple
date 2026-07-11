import { CampaignRecipientStatus } from "@prisma/client";
import { prisma } from "../prisma/client";

export type RecipientStatusSummary = Record<CampaignRecipientStatus, number>;

export function emptyRecipientStatusSummary(): RecipientStatusSummary {
  return {
    pending: 0,
    scheduled: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    canceled: 0
  };
}

export async function getCampaignRecipientCountMap(instanceId: string, campaignIds: string[]) {
  const result = new Map<string, RecipientStatusSummary>();

  if (campaignIds.length === 0) return result;

  const rows = await prisma.campaignRecipient.groupBy({
    by: ["campaignId", "status"],
    where: {
      instanceId,
      campaignId: { in: campaignIds }
    },
    _count: { _all: true }
  });

  for (const row of rows) {
    const summary = result.get(row.campaignId) ?? emptyRecipientStatusSummary();
    summary[row.status] = row._count._all;
    result.set(row.campaignId, summary);
  }

  return result;
}

export function totalRecipientCount(summary: RecipientStatusSummary) {
  return Object.values(summary).reduce((total, count) => total + count, 0);
}
