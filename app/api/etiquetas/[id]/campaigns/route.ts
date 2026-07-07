import { NextRequest, NextResponse } from "next/server";
import { CampaignStatus } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import {
  ABSOLUTE_MAX_RECIPIENTS,
  buildCampaignDedupeKey,
  buildLabelAudience,
  DEFAULT_EXCLUDE_ALREADY_SENT_DAYS,
  DEFAULT_MAX_RECIPIENTS
} from "@/src/lib/labels/audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id: labelId } = await context.params;
  const payload = (await request.json()) as {
    name?: string;
    message?: string;
    intervalMinutes?: number;
    includeGroups?: boolean;
    excludeGroups?: boolean;
    excludeAlreadySentDays?: number;
    maxRecipients?: number;
    sendWindowStart?: string | null;
    sendWindowEnd?: string | null;
    startNow?: boolean;
  };

  const name = String(payload.name ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const intervalMinutes = Number(payload.intervalMinutes ?? 1);
  const excludeGroups = true;
  const includeGroups = false;
  const excludeAlreadySentDays = Number(
    payload.excludeAlreadySentDays ?? DEFAULT_EXCLUDE_ALREADY_SENT_DAYS
  );
  const maxRecipients = Number(payload.maxRecipients ?? DEFAULT_MAX_RECIPIENTS);

  if (!name) {
    return NextResponse.json({ error: "Nome da campanha obrigatorio" }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: "Mensagem obrigatoria" }, { status: 400 });
  }

  if (message.length > 4000) {
    return NextResponse.json({ error: "Mensagem excede 4000 caracteres" }, { status: 400 });
  }

  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    return NextResponse.json(
      { error: "Intervalo deve ser inteiro e maior ou igual a 1 minuto" },
      { status: 400 }
    );
  }

  if (!Number.isFinite(maxRecipients) || maxRecipients < 1 || maxRecipients > ABSOLUTE_MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `maxRecipients deve estar entre 1 e ${ABSOLUTE_MAX_RECIPIENTS}` },
      { status: 400 }
    );
  }

  const audience = await buildLabelAudience({
    labelId,
    includeGroups,
    excludeOptOut: true,
    excludeAlreadySentDays,
    maxRecipients,
    limit: maxRecipients
  });

  if (!audience) {
    return NextResponse.json({ error: "Etiqueta nao encontrada ou inativa" }, { status: 404 });
  }

  if (audience.eligible === 0) {
    return NextResponse.json(
      {
        error: "Nenhum destinatario elegivel para esta etiqueta com os filtros atuais",
        audience
      },
      { status: 400 }
    );
  }

  const dedupeKey = `label:${labelId}:${Date.now()}`;
  const campaign = await prisma.campaign.create({
    data: {
      name,
      defaultMessage: message,
      intervalMinutes,
      status: CampaignStatus.draft,
      targetMode: "label",
      targetLabelId: audience.label.id,
      excludeGroups,
      excludeAlreadySentDays,
      dedupeKey,
      maxRecipients,
      sendWindowStart: payload.sendWindowStart?.trim() || null,
      sendWindowEnd: payload.sendWindowEnd?.trim() || null,
      recipients: {
        create: audience.eligibleRecipients.map((recipient) => ({
          chatId: recipient.chatId,
          jid: recipient.jid,
          messageFinal: message,
          dedupeKey: buildCampaignDedupeKey(dedupeKey, recipient.jid)
        }))
      }
    },
    include: {
      recipients: true,
      targetLabel: true
    }
  });

  if (payload.startNow === true) {
    const { schedulePendingRecipients } = await import("@/src/lib/campaigns/schedule");
    await prisma.campaign.update({
      where: {
        id: campaign.id
      },
      data: {
        status: CampaignStatus.running,
        startedAt: new Date()
      }
    });
    await schedulePendingRecipients(campaign.id);
  }

  return NextResponse.json(
    {
      campaign,
      audience: {
        total: audience.total,
        eligible: audience.eligible,
        skipped: audience.skipped,
        skippedReasons: audience.skippedReasons,
        jidTypeCounts: audience.jidTypeCounts
      },
      message: payload.startNow
        ? "Envio por etiqueta criado e iniciado."
        : "Envio por etiqueta criado em rascunho. Inicie em /envios."
    },
    { status: 201 }
  );
}
