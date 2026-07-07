import { NextResponse } from "next/server";
import { CampaignRecipientStatus, CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;

  await prisma.$transaction([
    prisma.campaign.updateMany({
      where: {
        id,
        status: {
          in: [CampaignStatus.draft, CampaignStatus.running, CampaignStatus.paused]
        }
      },
      data: {
        status: CampaignStatus.canceled
      }
    }),
    prisma.campaignRecipient.updateMany({
      where: {
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

