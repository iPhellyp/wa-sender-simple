import { NextRequest, NextResponse } from "next/server";
import { enqueueWhatsappIdentityRebuild } from "@/src/lib/queue/campaign-queue";
import {
  isWhatsappInstanceNotFoundError,
  requireWhatsappInstance
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const instance = await requireWhatsappInstance(request.nextUrl.searchParams.get("instanceId"));
    const job = await enqueueWhatsappIdentityRebuild(instance.id);
    return NextResponse.json({
      ok: true,
      jobId: job.jobId,
      deduped: job.deduped,
      message: job.deduped
        ? "A reconstrução de identidades já está em andamento."
        : "Reconstrução de identidades históricas enfileirada."
    });
  } catch (error) {
    if (isWhatsappInstanceNotFoundError(error)) {
      return NextResponse.json({ ok: false, error: "Instância não encontrada" }, { status: 404 });
    }
    return NextResponse.json(
      { ok: false, error: "Erro ao enfileirar reconstrução de identidades" },
      { status: 500 }
    );
  }
}
