import { NextRequest, NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { schedulePendingRecipients } from "@/src/lib/campaigns/schedule";
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
  const activeCampaign = await prisma.campaign.findFirst({
    where: {
      instanceId,
      id: {
        not: id
      },
      status: CampaignStatus.running
    },
    select: {
      id: true
    }
  });

  if (activeCampaign) {
    return NextResponse.json(
      {
        error:
          "Ja existe uma campanha ativa nesta instancia. Pause, cancele ou aguarde finalizar."
      },
      { status: 409 }
    );
  }

  const campaign = await prisma.campaign.updateMany({
    where: {
      id,
      instanceId,
      status: CampaignStatus.paused
    },
    data: {
      status: CampaignStatus.running
    }
  });

  if (campaign.count === 0) {
    return NextResponse.json({ error: "Campanha pausada nao encontrada" }, { status: 404 });
  }

  await schedulePendingRecipients(id);

  return NextResponse.json({ ok: true });
}
