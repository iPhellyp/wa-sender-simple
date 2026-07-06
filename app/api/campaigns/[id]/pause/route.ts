import { NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";

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
      status: CampaignStatus.running
    },
    data: {
      status: CampaignStatus.paused
    }
  });

  return NextResponse.json({ ok: true });
}
