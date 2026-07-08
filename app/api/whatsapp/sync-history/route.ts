import { NextRequest, NextResponse } from "next/server";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappHistorySync } from "@/src/lib/queue/campaign-queue";
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

export async function POST(request: NextRequest) {
  try {
    const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));
    const session = await getWhatsappInstanceRuntimeStatus(instance.id);

    if (!canAttemptSync(session)) {
      return NextResponse.json(
        {
          ok: false,
          mode: "event-driven",
          message: "Conecte esta instancia antes de sincronizar historico."
        },
        { status: 409 }
      );
    }

    const syncJob = await enqueueWhatsappHistorySync(instance.id);

    return NextResponse.json({
      ok: true,
      mode: "event-driven",
      jobId: syncJob.jobId,
      deduped: syncJob.deduped,
      message: syncJob.deduped
        ? "Sincronizacao de historico ja esta em andamento."
        : "Verificacao de historico enfileirada."
    });
  } catch (error) {
    if (isNoWhatsappInstanceError(error)) {
      return NextResponse.json({ ok: false, error: "Crie uma instancia antes de sincronizar" }, { status: 404 });
    }

    if (isWhatsappInstanceNotFoundError(error)) {
      return NextResponse.json({ ok: false, error: "Instancia nao encontrada" }, { status: 404 });
    }

    return NextResponse.json(
      { ok: false, error: "Erro ao enfileirar verificacao de historico" },
      { status: 500 }
    );
  }
}
