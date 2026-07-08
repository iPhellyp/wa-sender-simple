import { NextRequest, NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { schedulePendingRecipients } from "@/src/lib/campaigns/schedule";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

const finalCampaignStatuses: CampaignStatus[] = [
  CampaignStatus.canceled,
  CampaignStatus.completed
];

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      instanceId
    }
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 });
  }

  if (finalCampaignStatuses.includes(campaign.status)) {
    return NextResponse.json(
      { error: "Campanha finalizada nao pode ser iniciada" },
      { status: 400 }
    );
  }

  await prisma.campaign.update({
    where: {
      id
    },
    data: {
      status: CampaignStatus.running,
      startedAt: campaign.startedAt ?? new Date()
    }
  });

  await schedulePendingRecipients(id);

  return NextResponse.json({ ok: true });
}
