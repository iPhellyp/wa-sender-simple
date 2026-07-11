import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";
import {
  emptyRecipientStatusSummary,
  getCampaignRecipientCountMap,
  totalRecipientCount
} from "@/src/lib/campaigns/recipient-counts";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const campaigns = await prisma.campaign.findMany({
    where: {
      instanceId
    },
    include: {
      targetLabel: {
        select: {
          id: true,
          name: true,
          color: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  const campaignIds = campaigns.map((campaign) => campaign.id);
  const [countMap, skippedRows] = await Promise.all([
    getCampaignRecipientCountMap(instanceId, campaignIds),
    campaignIds.length
      ? prisma.campaignRecipient.groupBy({
          by: ["campaignId", "skippedReason"],
          where: {
            instanceId,
            campaignId: { in: campaignIds },
            skippedReason: { not: null }
          },
          _count: { _all: true }
        })
      : Promise.resolve([])
  ]);
  const skippedMap = new Map<string, Record<string, number>>();
  for (const row of skippedRows) {
    if (!row.skippedReason) continue;
    const counts = skippedMap.get(row.campaignId) ?? {};
    counts[row.skippedReason] = row._count._all;
    skippedMap.set(row.campaignId, counts);
  }

  return NextResponse.json({
    instanceId,
    campaigns: campaigns.map((campaign) => {
      const statusCounts = countMap.get(campaign.id) ?? emptyRecipientStatusSummary();

      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        targetMode: campaign.targetMode,
        targetLabel: campaign.targetLabel,
        intervalMinutes: campaign.intervalMinutes,
        maxRecipients: campaign.maxRecipients,
        excludeGroups: campaign.excludeGroups,
        excludeAlreadySentDays: campaign.excludeAlreadySentDays,
        createdAt: campaign.createdAt,
        scheduledAt: campaign.scheduledAt,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        hasMedia: Boolean(campaign.mediaPath),
        mediaKind: campaign.mediaKind,
        mediaOriginalName: campaign.mediaOriginalName,
        mediaMimeType: campaign.mediaMimeType,
        mediaSizeBytes: campaign.mediaSizeBytes,
        lastError: campaign.lastError,
        recipientCount: totalRecipientCount(statusCounts),
        recipientStatusCounts: statusCounts,
        skippedReasonCounts: skippedMap.get(campaign.id) ?? {}
      };
    })
  });
}
