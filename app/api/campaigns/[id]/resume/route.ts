import { NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { schedulePendingRecipients } from "@/src/lib/campaigns/schedule";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  await prisma.campaign.updateMany({
    where: {
      id,
      status: CampaignStatus.paused
    },
    data: {
      status: CampaignStatus.running
    }
  });

  await schedulePendingRecipients(id);

  return NextResponse.json({ ok: true });
}
