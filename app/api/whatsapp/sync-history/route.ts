import { NextResponse } from "next/server";
import { enqueueWhatsappHistorySync } from "@/src/lib/queue/campaign-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const jobId = await enqueueWhatsappHistorySync();

    return NextResponse.json({
      ok: true,
      jobId,
      message:
        "Solicitacao enviada ao worker. O historico completo depende dos eventos do WhatsApp; se a sessao antiga nao reenviar historico, pode ser necessario reconectar manualmente."
    });
  } catch {
    return NextResponse.json(
      { error: "Erro ao enfileirar sincronizacao de historico" },
      { status: 500 }
    );
  }
}
