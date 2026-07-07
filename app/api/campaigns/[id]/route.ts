import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const campaign = await prisma.campaign.findUnique({
    where: {
      id
    },
    include: {
      recipients: {
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

  return NextResponse.json(campaign);
}

