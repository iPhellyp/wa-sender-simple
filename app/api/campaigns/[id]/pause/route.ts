import { NextRequest, NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
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

  await prisma.campaign.updateMany({
    where: {
      id,
      instanceId,
      status: CampaignStatus.running
    },
    data: {
      status: CampaignStatus.paused
    }
  });

  return NextResponse.json({ ok: true });
}
