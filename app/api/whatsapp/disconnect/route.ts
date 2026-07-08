import { NextRequest, NextResponse } from "next/server";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappDisconnect } from "@/src/lib/queue/campaign-queue";
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
    return NextResponse.json({ error: "instanceId obrigatorio para desconectar" }, { status: 400 });
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
    await clearWhatsappOperationalData("manual-disconnect", instance.id);
    await enqueueWhatsappDisconnect(instance.id);

    return NextResponse.json({
      ...(await getWhatsappInstanceRuntimeStatus(instance.id)),
      message: "Desconexao enfileirada para esta instancia"
    });
  } catch (error) {
    return NextResponse.json(
      {
        ...(await getWhatsappInstanceRuntimeStatus(instance.id)),
        error: error instanceof Error ? error.message : "Falha ao enfileirar desconexao"
      },
      { status: 500 }
    );
  }
}
