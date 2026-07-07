import { NextResponse } from "next/server";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import { enqueueWhatsappHistorySync } from "@/src/lib/queue/campaign-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getWhatsappStatusPayload();

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

    const jobId = await enqueueWhatsappHistorySync();

    return NextResponse.json({
      ok: true,
      mode: "event-driven",
      jobId,
      message: "Verificacao de historico enfileirada."
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erro ao enfileirar verificacao de historico" },
      { status: 500 }
    );
  }
}
