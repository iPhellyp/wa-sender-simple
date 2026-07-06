import { NextResponse } from "next/server";
import {
  getWhatsappStatusPayload,
  markWhatsappDisconnected,
  markWhatsappError
} from "@/src/lib/baileys/client";
import { enqueueWhatsappDisconnect } from "@/src/lib/queue/campaign-queue";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

export async function POST() {
  try {
    await markWhatsappDisconnected();
    await enqueueWhatsappDisconnect();

    return NextResponse.json(await getWhatsappStatusPayload());
  } catch (error) {
    const lastError = `Falha ao enfileirar desconexao WhatsApp: ${getErrorMessage(error)}`;
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
