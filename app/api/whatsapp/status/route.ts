import { NextResponse } from "next/server";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [session, latestMessage] = await Promise.all([
    getWhatsappStatusPayload(),
    prisma.whatsappMessage.findFirst({
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

