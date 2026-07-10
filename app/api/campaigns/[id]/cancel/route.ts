import { NextRequest, NextResponse } from "next/server";
import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);

  await prisma.$transaction([
    prisma.campaign.updateMany({
      where: {
        id,
        instanceId,
        status: {
          in: [
            CampaignStatus.draft,
            CampaignStatus.scheduled,
            CampaignStatus.running,
            CampaignStatus.paused
          ]
        }
      },
      data: {
        status: CampaignStatus.canceled
      }
    }),
    prisma.campaignRecipient.updateMany({
      where: {
        instanceId,
        campaignId: id,
        status: {
          in: [
            CampaignRecipientStatus.pending,
            CampaignRecipientStatus.scheduled,
            CampaignRecipientStatus.sending
          ]
        }
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Campanha cancelada"
      }
    })
  ]);

  return NextResponse.json({ ok: true });
}
