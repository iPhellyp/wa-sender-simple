import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const existing = await prisma.whatsappInstance.findUnique({
    where: {
      id
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
  }

  const instance = await prisma.$transaction(async (transaction) => {
    await transaction.whatsappInstance.updateMany({
      data: {
        isDefault: false
      }
    });

    return transaction.whatsappInstance.update({
      where: {
        id
      },
      data: {
        isDefault: true
      }
    });
  });

  return NextResponse.json({ instance });
}
