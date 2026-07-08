import { NextRequest, NextResponse } from "next/server";
import { WhatsappStatus } from "@prisma/client";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappReset } from "@/src/lib/queue/campaign-queue";
import { prisma } from "@/src/lib/prisma/client";
import { clearWhatsappOperationalData } from "@/src/lib/server/whatsapp-session-data";
import {
  isWhatsappInstanceNotFoundError,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

async function getRequestedInstanceId(request: NextRequest) {
  const queryInstanceId = request.nextUrl.searchParams.get("instanceId");

  if (queryInstanceId) {
    return queryInstanceId;
  }

  const payload = (await request.json().catch(() => null)) as { instanceId?: string } | null;
  return payload?.instanceId ?? null;
}

export async function POST(request: NextRequest) {
  const requestedInstanceId = await getRequestedInstanceId(request);

  if (!requestedInstanceId) {
    return NextResponse.json({ error: "instanceId obrigatorio para resetar sessao" }, { status: 400 });
  }

  let instance;

  try {
    instance = await requireWhatsappInstance(requestedInstanceId);
  } catch (error) {
    if (isWhatsappInstanceNotFoundError(error)) {
      return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
    }

    throw error;
  }

  try {
    await clearWhatsappOperationalData("manual-reset", instance.id);
    await prisma.whatsappSession.updateMany({
      where: {
        instanceId: instance.id
      },
      data: {
        status: WhatsappStatus.disconnected,
        qrCode: null,
        connectedPhone: null,
        lastError: null
      }
    });
    await prisma.whatsappInstance.update({
      where: {
        id: instance.id
      },
      data: {
        status: WhatsappStatus.disconnected,
        phone: null
      }
    });
    const jobId = await enqueueWhatsappReset(instance.id);
    console.log("[whatsapp-api] reset enqueued", {
      action: "reset_session",
      instanceId: instance.id,
      sessionKey: instance.sessionKey,
      jobId
    });

    return NextResponse.json({
      ...(await getWhatsappInstanceRuntimeStatus(instance.id)),
      message: "Reset de sessao WhatsApp enfileirado para esta instancia"
    });
  } catch (error) {
    return NextResponse.json(
      {
        ...(await getWhatsappInstanceRuntimeStatus(instance.id)),
        error: error instanceof Error ? error.message : "Falha ao enfileirar reset"
      },
      { status: 500 }
    );
  }
}
