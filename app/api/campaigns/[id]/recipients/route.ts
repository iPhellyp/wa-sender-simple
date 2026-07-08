import { NextRequest, NextResponse } from "next/server";
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
  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      instanceId,
      campaignId: id
    },
    include: {
      contact: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return NextResponse.json({ recipients });
}
