import { NextRequest, NextResponse } from "next/server";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappConnect } from "@/src/lib/queue/campaign-queue";
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
  let instance;

  try {
    instance = await requireWhatsappInstance(await getRequestedInstanceId(request));
  } catch (error) {
    if (isWhatsappInstanceNotFoundError(error)) {
      return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
    }

    throw error;
  }

  const currentSession = await getWhatsappInstanceRuntimeStatus(instance.id);

  if (currentSession.status === "connecting" || currentSession.status === "qr") {
    return NextResponse.json({
      ...currentSession,
      message: "Conexao WhatsApp ja esta em andamento"
    });
  }

  await enqueueWhatsappConnect(instance.id);

  return NextResponse.json({
    ...currentSession,
    instanceId: instance.id,
    message: "Conexao WhatsApp enfileirada para esta instancia"
  });
}
