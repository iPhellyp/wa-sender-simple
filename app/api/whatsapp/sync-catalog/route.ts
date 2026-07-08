import { NextRequest, NextResponse } from "next/server";
import { enqueueWhatsappCatalogSync } from "@/src/lib/queue/campaign-queue";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { requireWhatsappInstance } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getRequestPayload(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    instanceId?: string;
    forceSnapshot?: boolean;
  } | null;

  return {
    instanceId: request.nextUrl.searchParams.get("instanceId") ?? payload?.instanceId ?? null,
    forceSnapshot: payload?.forceSnapshot ?? request.nextUrl.searchParams.get("forceSnapshot") === "true"
  };
}

export async function POST(request: NextRequest) {
  const payload = await getRequestPayload(request);
  const instance = await requireWhatsappInstance(payload.instanceId);
  const session = await getWhatsappInstanceRuntimeStatus(instance.id);

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

  const jobId = await enqueueWhatsappCatalogSync({
    instanceId: instance.id,
    forceSnapshot: payload.forceSnapshot ?? true
  });

  return NextResponse.json({
    ok: true,
    jobId,
    instanceId: instance.id,
    message:
      "Resync de catalogo/app-state enviado para esta instancia. Aguarde 1 a 3 minutos."
  });
}
