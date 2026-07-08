import { NextRequest, NextResponse } from "next/server";
import { enqueueWhatsappCatalogSync } from "@/src/lib/queue/campaign-queue";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));

  if (instance.id !== DEFAULT_WHATSAPP_INSTANCE_ID) {
    return NextResponse.json(
      { error: "Sincronizacao por instancia entra na proxima fase." },
      { status: 409 }
    );
  }

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
