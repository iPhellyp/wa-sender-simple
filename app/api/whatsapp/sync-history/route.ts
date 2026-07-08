import { NextRequest, NextResponse } from "next/server";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappHistorySync } from "@/src/lib/queue/campaign-queue";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  isWhatsappInstanceNotFoundError,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));
    const session = await getWhatsappInstanceRuntimeStatus(instance.id);

    if (session.status !== "connected") {
      return NextResponse.json(
        {
          ok: false,
          mode: "event-driven",
          message: "WhatsApp precisa estar conectado para verificar historico."
        },
        { status: 409 }
      );
    }

    if (instance.id !== DEFAULT_WHATSAPP_INSTANCE_ID) {
      return NextResponse.json({
        ok: true,
        mode: "event-driven",
        message:
          "Historico desta instancia e salvo por eventos do proprio socket. Use sincronizacao de catalogo para contatos e etiquetas."
      });
    }

    const jobId = await enqueueWhatsappHistorySync(instance.id);

    return NextResponse.json({
      ok: true,
      mode: "event-driven",
      jobId,
      message: "Verificacao de historico enfileirada."
    });
  } catch (error) {
    if (isWhatsappInstanceNotFoundError(error)) {
      return NextResponse.json({ ok: false, error: "Instancia nao encontrada" }, { status: 404 });
    }

    return NextResponse.json(
      { ok: false, error: "Erro ao enfileirar verificacao de historico" },
      { status: 500 }
    );
  }
}
