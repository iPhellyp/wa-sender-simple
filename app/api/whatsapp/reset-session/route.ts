import { NextRequest, NextResponse } from "next/server";
import {
  getWhatsappStatusPayload,
  markWhatsappDisconnected,
  markWhatsappError
} from "@/src/lib/baileys/client";
import { enqueueWhatsappReset } from "@/src/lib/queue/campaign-queue";
import { prisma } from "@/src/lib/prisma/client";
import { clearWhatsappOperationalData } from "@/src/lib/server/whatsapp-session-data";
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
    const updated = await prisma.whatsappInstance.update({
      where: {
        id: instance.id
      },
      data: {
        status: "disconnected",
        lastConnectedAt: null
      }
    });

    return NextResponse.json({
      id: updated.id,
      instanceId: updated.id,
      status: updated.status,
      qrCode: null,
      hasQrCode: false,
      connectedPhone: updated.phone,
      lastError: null,
      updatedAt: updated.updatedAt,
      message: "Reset preparado. Multi-socket entra na proxima fase."
    });
  }

  try {
    await clearWhatsappOperationalData("manual-reset", instance.id);
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
