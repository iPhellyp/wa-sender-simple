import { NextResponse } from "next/server";
import { markWhatsappDisconnected } from "@/src/lib/baileys/client";
import { enqueueWhatsappDisconnect } from "@/src/lib/queue/campaign-queue";
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
  const instance = await prisma.whatsappInstance.findUnique({
    where: {
      id
    }
  });

  if (!instance) {
    return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
  }

  if (instance.sessionKey === "default") {
    await markWhatsappDisconnected();
    await enqueueWhatsappDisconnect();
  }

  const updated = await prisma.whatsappInstance.update({
    where: {
      id
    },
    data: {
      status: "disconnected"
    }
  });

  return NextResponse.json({
    instance: updated,
    message:
      instance.sessionKey === "default"
        ? "Desconexao enfileirada para a instancia padrao."
        : "Instancia preparada como desconectada. Multi-socket entra na proxima fase."
  });
}
