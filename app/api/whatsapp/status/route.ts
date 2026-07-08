import { NextRequest, NextResponse } from "next/server";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { prisma } from "@/src/lib/prisma/client";
import { requireWhatsappInstance } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));
  const [session, latestMessage] = await Promise.all([
    getWhatsappInstanceRuntimeStatus(instance.id),
    prisma.whatsappMessage.findFirst({
      where: {
        instanceId: instance.id
      },
      orderBy: [
        {
          timestamp: {
            sort: "desc",
            nulls: "last"
          }
        },
        {
          createdAt: "desc"
        }
      ],
      select: {
        timestamp: true,
        createdAt: true
      }
    })
  ]);

  return NextResponse.json({
    ...session,
    latestMessageAt: (latestMessage?.timestamp ?? latestMessage?.createdAt)?.toISOString() ?? null
  });
}
