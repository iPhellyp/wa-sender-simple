import { NextRequest, NextResponse } from "next/server";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import { prisma } from "@/src/lib/prisma/client";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));
  const [session, latestMessage] = await Promise.all([
    instance.id === DEFAULT_WHATSAPP_INSTANCE_ID
      ? getWhatsappStatusPayload()
      : Promise.resolve({
          id: instance.id,
          status: instance.status,
          qrCode: null,
          hasQrCode: false,
          connectedPhone: instance.phone,
          lastError: null,
          updatedAt: instance.updatedAt
        }),
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
    instanceId: instance.id,
    instanceName: instance.name,
    latestMessageAt: (latestMessage?.timestamp ?? latestMessage?.createdAt)?.toISOString() ?? null
  });
}
