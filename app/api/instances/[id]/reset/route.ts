import { NextResponse } from "next/server";
import { markWhatsappDisconnected } from "@/src/lib/baileys/client";
import { enqueueWhatsappReset } from "@/src/lib/queue/campaign-queue";
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
    await enqueueWhatsappReset();
  }

  const updated = await prisma.whatsappInstance.update({
    where: {
      id
    },
    data: {
      status: "disconnected",
      lastConnectedAt: null
    }
  });

  return NextResponse.json({
    instance: updated,
    message:
      instance.sessionKey === "default"
        ? "Reset enfileirado para a instancia padrao."
        : "Reset preparado. Multi-socket e sessoes separadas entram na proxima fase."
  });
}
