import { NextRequest, NextResponse } from "next/server";
import { renderCampaignMessage } from "@/src/lib/campaigns/message-template";
import { parseCampaignScheduleInput } from "@/src/lib/campaigns/scheduling-input";
import { startCampaign } from "@/src/lib/campaigns/start-campaign";
import { prisma } from "@/src/lib/prisma/client";
import {
  ABSOLUTE_MAX_RECIPIENTS,
  buildCampaignDedupeKey,
  buildLabelAudience,
  DEFAULT_EXCLUDE_ALREADY_SENT_DAYS,
  DEFAULT_MAX_RECIPIENTS
} from "@/src/lib/labels/audience";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeAdvancedSettings(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return `settings:${JSON.stringify(value)}`;
}

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
    advancedSettings?: unknown;
    startNow?: boolean;
    instanceId?: string;
    sendMode?: "NOW" | "SCHEDULED";
    scheduledAt?: string | null;
  };
  const instanceId = await getActiveInstanceIdFromSearchOrDefault({
    instanceId: payload.instanceId
  });

  const name = String(payload.name ?? "").trim();
  const message = String(payload.message ?? "").trim();
  const intervalMinutes = Number(payload.intervalMinutes ?? 1);
  const excludeGroups = true;
  const includeGroups = false;
  const excludeAlreadySentDays = Number(
    payload.excludeAlreadySentDays ?? DEFAULT_EXCLUDE_ALREADY_SENT_DAYS
  );
  const maxRecipients = Number(payload.maxRecipients ?? DEFAULT_MAX_RECIPIENTS);
  const scheduleInput = parseCampaignScheduleInput(payload.sendMode, payload.scheduledAt);

  if (!name) {
    return NextResponse.json({ error: "Nome da campanha obrigatorio" }, { status: 400 });
  }

  if (!scheduleInput.ok) {
    return NextResponse.json({ error: scheduleInput.error }, { status: 400 });
  }

  if (payload.startNow === true && scheduleInput.sendMode === "SCHEDULED") {
    return NextResponse.json(
      { error: "Campanha agendada nao pode usar inicio automatico" },
      { status: 400 }
    );
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
    instanceId,
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
        error:
          "Nenhum contato elegivel nesta etiqueta. Verifique contatos sem numero ou sincronize os chats.",
        audience
      },
      { status: 400 }
    );
  }

  const dedupeKey = `label:${labelId}:${Date.now()}`;
  const campaign = await prisma.campaign.create({
    data: {
      name,
      instanceId,
      defaultMessage: message,
      intervalMinutes,
      status: scheduleInput.status,
      scheduledAt: scheduleInput.scheduledAt,
      targetMode: "label",
      targetLabelId: audience.label.id,
      excludeGroups,
      excludeAlreadySentDays,
      dedupeKey,
      maxRecipients,
      sendWindowStart: serializeAdvancedSettings(payload.advancedSettings) ?? payload.sendWindowStart?.trim() ?? null,
      sendWindowEnd: payload.sendWindowEnd?.trim() || null,
      recipients: {
        create: audience.eligibleRecipients.map((recipient) => ({
          instanceId,
          chatId: recipient.chatId,
          jid: recipient.jid,
          messageFinal: renderCampaignMessage(message, {
            name: recipient.name,
            phoneNormalized: recipient.phoneNormalized,
            source: audience.label.name
          }),
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
    const startResult = await startCampaign({
      campaignId: campaign.id,
      instanceId,
      origin: "MANUAL"
    });

    if (!startResult.started && !startResult.alreadyStarted) {
      return NextResponse.json(
        {
          error:
            startResult.reason === "another_campaign_running"
              ? "Ja existe uma campanha ativa nesta instancia. Pause, cancele ou aguarde finalizar."
              : "Campanha criada, mas nao pode ser iniciada no status atual",
          campaign
        },
        { status: startResult.reason === "another_campaign_running" ? 409 : 400 }
      );
    }
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
        : scheduleInput.sendMode === "SCHEDULED"
          ? "Envio por etiqueta agendado."
          : "Envio por etiqueta criado em rascunho. Inicie em /envios."
    },
    { status: 201 }
  );
}

