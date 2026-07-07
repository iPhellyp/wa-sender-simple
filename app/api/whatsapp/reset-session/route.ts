import { NextResponse } from "next/server";
import {
  getWhatsappStatusPayload,
  markWhatsappDisconnected,
  markWhatsappError,
} from "@/src/lib/baileys/client";
import { enqueueWhatsappReset } from "@/src/lib/queue/campaign-queue";
import { clearWhatsappOperationalData } from "@/src/lib/server/whatsapp-session-data";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

export async function POST() {
  try {
    await clearWhatsappOperationalData("manual-reset");
    await markWhatsappDisconnected();
    await enqueueWhatsappReset();

    return NextResponse.json({
      ...(await getWhatsappStatusPayload()),
      message: "Reset de sessao WhatsApp enfileirado"
    });
  } catch (error) {
    const lastError = `Falha ao resetar sessao WhatsApp: ${getErrorMessage(error)}`;
    await markWhatsappError(lastError).catch(() => undefined);

    return NextResponse.json(
      {
        ...(await getWhatsappStatusPayload()),
        error: lastError
      },
      { status: 500 }
    );
  }
}
