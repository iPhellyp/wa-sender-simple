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
  const recipients = await prisma.campaignRecipient.findMany({
    where: {
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
