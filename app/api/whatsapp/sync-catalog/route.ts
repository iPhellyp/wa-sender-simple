import { NextResponse } from "next/server";
import { enqueueWhatsappCatalogSync } from "@/src/lib/queue/campaign-queue";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getWhatsappStatusPayload();

  if (session.status === "qr") {
    return NextResponse.json(
      { error: "WhatsApp aguardando leitura do QR Code" },
      { status: 409 }
    );
  }

  if (session.status !== "connected" && !session.connectedPhone) {
    return NextResponse.json(
      { error: "WhatsApp precisa estar conectado antes de sincronizar catalogo" },
      { status: 409 }
    );
  }

  const jobId = await enqueueWhatsappCatalogSync({ forceSnapshot: true });

  return NextResponse.json({
    ok: true,
    jobId,
    message:
      "Resync de catalogo/app-state enviado. Aguarde 1 a 3 minutos e recarregue conversas/etiquetas."
  });
}

