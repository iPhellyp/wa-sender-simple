import { NextRequest, NextResponse } from "next/server";
import { enqueueWhatsappCatalogSync } from "@/src/lib/queue/campaign-queue";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import {
  isNoWhatsappInstanceError,
  isWhatsappInstanceNotFoundError,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canAttemptSync(session: Awaited<ReturnType<typeof getWhatsappInstanceRuntimeStatus>>) {
  return Boolean(
    session.status === "connected" ||
    session.connectedPhone ||
    session.hasRegisteredSession ||
    session.hasMeId ||
    session.isRecoverableSession
  );
}

async function getRequestPayload(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    instanceId?: string;
    forceSnapshot?: boolean;
  } | null;

  return {
    instanceId: request.nextUrl.searchParams.get("instanceId") ?? payload?.instanceId ?? null,
    forceSnapshot: payload?.forceSnapshot ?? request.nextUrl.searchParams.get("forceSnapshot") === "true"
  };
}

export async function POST(request: NextRequest) {
  const payload = await getRequestPayload(request);
  let instance;

  try {
    instance = await requireWhatsappInstance(payload.instanceId);
  } catch (error) {
    if (isNoWhatsappInstanceError(error)) {
      return NextResponse.json({ error: "Crie uma instancia antes de sincronizar" }, { status: 404 });
    }

    if (isWhatsappInstanceNotFoundError(error)) {
      return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
    }

    throw error;
  }

  const session = await getWhatsappInstanceRuntimeStatus(instance.id);

  if (session.status === "qr" && !session.hasRegisteredSession && !session.hasMeId && !session.connectedPhone) {
    return NextResponse.json(
      { error: "WhatsApp aguardando leitura do QR Code" },
      { status: 409 }
    );
  }

  if (!canAttemptSync(session)) {
    return NextResponse.json(
      { error: "Conecte esta instancia antes de sincronizar catalogo" },
      { status: 409 }
    );
  }

  const syncJob = await enqueueWhatsappCatalogSync({
    instanceId: instance.id,
    forceSnapshot: payload.forceSnapshot ?? false
  });
  const syncType = payload.forceSnapshot ? "full" : "quick";

  return NextResponse.json({
    ok: true,
    jobId: syncJob.jobId,
    deduped: syncJob.deduped,
    instanceId: instance.id,
    syncType,
    message: syncJob.deduped
      ? "Sincronizacao ja esta em andamento para esta instancia."
      : syncType === "full"
        ? "Sincronizacao completa enfileirada. Pode demorar alguns minutos."
        : "Sincronizacao rapida enfileirada."
  });
}
