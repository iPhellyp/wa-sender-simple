import { NextRequest, NextResponse } from "next/server";
import {
  getWhatsappStatusPayload,
  markWhatsappConnecting,
  markWhatsappError
} from "@/src/lib/baileys/client";
import { enqueueWhatsappConnect } from "@/src/lib/queue/campaign-queue";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

export async function POST(request: NextRequest) {
  const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));

  if (instance.id !== DEFAULT_WHATSAPP_INSTANCE_ID) {
    return NextResponse.json(
      {
        id: instance.id,
        instanceId: instance.id,
        status: instance.status,
        qrCode: null,
        hasQrCode: false,
        connectedPhone: instance.phone,
        lastError: null,
        updatedAt: instance.updatedAt,
        error: "Conexao por instancia entra na proxima fase."
      },
      { status: 409 }
    );
  }

  try {
    const currentSession = await getWhatsappStatusPayload();

    if (currentSession.status === "connecting" || currentSession.status === "qr") {
      return NextResponse.json({
        ...currentSession,
        message: "Conexao WhatsApp ja esta em andamento"
      });
    }

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
