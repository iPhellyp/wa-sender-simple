import { NextResponse } from "next/server";
import { CampaignRecipientStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function countRecipientsByStatus(
  recipients: Array<{
    status: CampaignRecipientStatus;
    skippedReason: string | null;
  }>
) {
  const statusCounts = recipients.reduce<Record<string, number>>((accumulator, recipient) => {
    accumulator[recipient.status] = (accumulator[recipient.status] ?? 0) + 1;
    return accumulator;
  }, {});

  const skippedReasons = recipients.reduce<Record<string, number>>((accumulator, recipient) => {
    if (!recipient.skippedReason) {
      return accumulator;
    }

    accumulator[recipient.skippedReason] = (accumulator[recipient.skippedReason] ?? 0) + 1;
    return accumulator;
  }, {});

  return { statusCounts, skippedReasons };
}

export async function GET() {
  const campaigns = await prisma.campaign.findMany({
    include: {
      targetLabel: {
        select: {
          id: true,
          name: true,
          color: true
        }
      },
      recipients: {
        select: {
          status: true,
          skippedReason: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return NextResponse.json({
    campaigns: campaigns.map((campaign) => {
      const counts = countRecipientsByStatus(campaign.recipients);

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
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        recipientCount: campaign.recipients.length,
        recipientStatusCounts: counts.statusCounts,
        skippedReasonCounts: counts.skippedReasons
      };
    })
  });
}

