import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/src/lib/prisma/client";
import { enqueueApplyWhatsappLabels } from "@/src/lib/queue/campaign-queue";
import { applyLocalContactLabel } from "@/src/lib/server/contact-labels";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const payload = (await request.json()) as {
    contactIds?: string[];
    instanceId?: string;
    labelId?: string;
  };
  const instanceId = await getActiveInstanceIdFromSearchOrDefault({
    instanceId: payload.instanceId
  });
  const contactIds = Array.isArray(payload.contactIds)
    ? Array.from(new Set(payload.contactIds.map((id) => String(id).trim()).filter(Boolean)))
    : [];
  const labelId = String(payload.labelId ?? "").trim();

  if (contactIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um contato" }, { status: 400 });
  }

  if (contactIds.length > 500) {
    return NextResponse.json({ error: "Limite de 500 contatos por lote" }, { status: 400 });
  }

  if (!labelId) {
    return NextResponse.json({ error: "Etiqueta obrigatoria" }, { status: 400 });
  }

  const label = await prisma.whatsappLabel.findFirst({
    where: {
      instanceId,
      id: labelId,
      deleted: false
    },
    select: {
      id: true,
      waLabelId: true,
      name: true
    }
  });

  if (!label) {
    return NextResponse.json({ error: "Etiqueta nao encontrada" }, { status: 404 });
  }

  const result = await applyLocalContactLabel({
    instanceId,
    contactIds,
    labelName: label.name
  });

  let jobId: string | null = null;

  if (result.jids.length > 0) {
    jobId = await enqueueApplyWhatsappLabels({
      requestId: randomUUID(),
      labelId: label.id,
      waLabelId: label.waLabelId,
      jids: result.jids
    });
  }

  return NextResponse.json({
    ...result,
    jobId,
    message:
      result.jids.length > 0
        ? "Etiqueta local aplicada e sincronizacao com WhatsApp enfileirada."
        : "Etiqueta local aplicada; nenhum contato correspondente foi encontrado no WhatsApp."
  });
}

