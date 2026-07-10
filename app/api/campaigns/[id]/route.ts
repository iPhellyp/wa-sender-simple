import { NextRequest, NextResponse } from "next/server";
import { serializeCampaignForApi } from "@/src/lib/campaigns/media";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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
    },
    include: {
      recipients: {
        where: {
          instanceId
        },
        include: {
          contact: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 });
  }

  return NextResponse.json(serializeCampaignForApi(campaign));
}
