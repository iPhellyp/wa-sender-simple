import { NextRequest, NextResponse } from "next/server";
import { WhatsappStatus } from "@prisma/client";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappConnect } from "@/src/lib/queue/campaign-queue";
import { prisma } from "@/src/lib/prisma/client";
import {
  isNoWhatsappInstanceError,
  isWhatsappInstanceNotFoundError,
  DEFAULT_WHATSAPP_INSTANCE_ID,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
const QR_STALE_MS = 180_000;

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

    if (isNoWhatsappInstanceError(error)) {
      return NextResponse.json({ error: "Crie uma instancia para conectar o WhatsApp" }, { status: 404 });
    }

    throw error;
  }

  const currentSession = await getWhatsappInstanceRuntimeStatus(instance.id);

  const hasConfirmedSession = Boolean(
    currentSession.hasRegisteredSession ||
    currentSession.hasMeId ||
    currentSession.connectedPhone ||
    currentSession.status === WhatsappStatus.connected
  );
  const action = hasConfirmedSession ? "resume_session" : "generate_qr";
  const currentUpdatedAt = currentSession.updatedAt ? new Date(currentSession.updatedAt).getTime() : Date.now();
  const isQrStale =
    currentSession.status === "qr" &&
    !currentSession.connectedPhone &&
    Date.now() - currentUpdatedAt > QR_STALE_MS;

  if (currentSession.status === "qr" && currentSession.hasQrCode && !currentSession.isPairingPartial && !isQrStale) {
    return NextResponse.json({
      ...currentSession,
      message: "Conexao WhatsApp ja esta em andamento"
    });
  }

  const sessionId =
    instance.id === DEFAULT_WHATSAPP_INSTANCE_ID
      ? DEFAULT_WHATSAPP_INSTANCE_ID
      : `instance:${instance.id}`;

  await prisma.whatsappSession.upsert({
    where: {
      id: sessionId
    },
    update: {
      status: WhatsappStatus.connecting,
      qrCode: null,
      lastError: null,
      ...(action === "generate_qr" ? { connectedPhone: null } : {})
    },
    create: {
      id: sessionId,
      instanceId: instance.id,
      status: WhatsappStatus.connecting,
      qrCode: null,
      lastError: null,
      connectedPhone: null
    }
  });
  await prisma.whatsappInstance.update({
    where: {
      id: instance.id
    },
    data: {
      status: WhatsappStatus.connecting,
      ...(action === "generate_qr" ? { phone: null } : {})
    }
  });

  const jobId = await enqueueWhatsappConnect(instance.id);
  console.log("[whatsapp-api] connection enqueued", {
    action,
    instanceId: instance.id,
    sessionKey: instance.sessionKey,
    hasCredsJson: currentSession.hasCredsJson ?? false,
    hasRegisteredSession: currentSession.hasRegisteredSession ?? false,
    hasMeId: currentSession.hasMeId ?? false,
    isPairingPartial: currentSession.isPairingPartial ?? false,
    sessionFilesCount: currentSession.sessionFilesCount ?? 0,
    jobId
  });

  return NextResponse.json({
    ...currentSession,
    instanceId: instance.id,
    status: WhatsappStatus.connecting,
    qrCode: null,
    hasQrCode: false,
    hasRegisteredSession: currentSession.hasRegisteredSession ?? false,
    hasMeId: currentSession.hasMeId ?? false,
    isPairingPartial: currentSession.isPairingPartial ?? false,
    message: action === "generate_qr"
      ? "Geracao de QR enfileirada para esta instancia"
      : "Retomada de sessao enfileirada para esta instancia"
  });
}
