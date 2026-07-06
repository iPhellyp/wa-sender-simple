import { NextResponse } from "next/server";
import {
  getWhatsappStatusPayload,
  markWhatsappConnecting,
  markWhatsappError
} from "@/src/lib/baileys/client";
import { enqueueWhatsappConnect } from "@/src/lib/queue/campaign-queue";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

export async function POST() {
  try {
    await markWhatsappConnecting();
    await enqueueWhatsappConnect();

    return NextResponse.json({
      ...(await getWhatsappStatusPayload()),
      message: "Conexao WhatsApp enfileirada"
    });
  } catch (error) {
    const lastError = `Falha ao enfileirar conexao WhatsApp: ${getErrorMessage(error)}`;
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
