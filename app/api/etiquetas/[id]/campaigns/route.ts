import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { renderCampaignMessage } from "@/src/lib/campaigns/message-template";
import {
  CampaignMediaError,
  createCampaignWithOptionalMedia,
  parseCampaignCreateRequest,
  serializeCampaignForApi
} from "@/src/lib/campaigns/media";
import { parseCampaignScheduleInput } from "@/src/lib/campaigns/scheduling-input";
import { startCampaign } from "@/src/lib/campaigns/start-campaign";
import { prisma } from "@/src/lib/prisma/client";
import {
  buildCampaignDedupeKey,
  buildLabelAudience,
  DEFAULT_EXCLUDE_ALREADY_SENT_DAYS
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

function campaignMediaErrorResponse(error: unknown) {
  if (error instanceof CampaignMediaError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  throw error;
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id: labelId } = await context.params;
  let parsedRequest: Awaited<ReturnType<typeof parseCampaignCreateRequest>>;

  try {
    parsedRequest = await parseCampaignCreateRequest(request);
  } catch (error) {
    return campaignMediaErrorResponse(error);
  }

  const payload = parsedRequest.payload as {
    name?: string;
    message?: string;
    intervalMinutes?: number;
    includeGroups?: boolean;
    excludeGroups?: boolean;
    excludeAlreadySentDays?: number;
    maxRecipients?: number | null;
    sendWindowStart?: string | null;
    sendWindowEnd?: string | null;
    advancedSettings?: unknown;
    dedupeMode?: "same_campaign" | "recent_days" | "allow_resend";
    creationKey?: string;
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
  const dedupeMode = payload.dedupeMode ?? "same_campaign";
  const excludeAlreadySentDays =
    dedupeMode === "recent_days"
      ? Number(payload.excludeAlreadySentDays ?? DEFAULT_EXCLUDE_ALREADY_SENT_DAYS)
      : 0;
  const maxRecipients =
    payload.maxRecipients === null || payload.maxRecipients === undefined
      ? null
      : Number(payload.maxRecipients);
  const creationKey = String(payload.creationKey ?? randomUUID()).trim();
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

  if (!(["same_campaign", "recent_days", "allow_resend"] as const).includes(dedupeMode)) {
    return NextResponse.json({ error: "Modo de repeticao invalido" }, { status: 400 });
  }

  if (
    dedupeMode === "recent_days" &&
    (!Number.isInteger(excludeAlreadySentDays) || excludeAlreadySentDays < 1)
  ) {
    return NextResponse.json({ error: "Dias de exclusao deve ser inteiro e maior que zero" }, { status: 400 });
  }

  if (maxRecipients !== null && (!Number.isInteger(maxRecipients) || maxRecipients < 1)) {
    return NextResponse.json({ error: "maxRecipients deve ser inteiro e maior que zero" }, { status: 400 });
  }

  if (!creationKey || creationKey.length > 120) {
    return NextResponse.json({ error: "Chave de criacao invalida" }, { status: 400 });
  }

  const existingCampaign = await prisma.campaign.findFirst({
    where: { instanceId, creationKey },
    include: { targetLabel: true }
  });

  if (existingCampaign) {
    return NextResponse.json({
      campaign: serializeCampaignForApi(existingCampaign),
      idempotent: true,
      message: "Campanha ja criada por esta solicitacao."
    });
  }

  const audience = await buildLabelAudience({
    instanceId,
    labelId,
    includeGroups,
    excludeOptOut: true,
    excludeAlreadySentDays,
    maxRecipients,
    limit: 20
  });

  if (!audience) {
    return NextResponse.json({ error: "Etiqueta nao encontrada ou inativa" }, { status: 404 });
  }

  if (audience.selected === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum contato elegivel nesta etiqueta. Verifique contatos sem numero ou sincronize os chats.",
        audience
      },
      { status: 400 }
    );
  }

  const dedupeKey = `label:${labelId}:${creationKey}`;
  const recipientRows = audience.eligibleRecipients.map((recipient) => ({
    instanceId,
    chatId: recipient.chatId,
    jid: recipient.jid,
    messageFinal: renderCampaignMessage(message, {
      name: recipient.name,
      phoneNormalized: recipient.phoneNormalized,
      source: audience.label.name
    }),
    dedupeKey: buildCampaignDedupeKey(dedupeKey, recipient.jid)
  }));
  const createLabelCampaignWithMedia = () =>
    createCampaignWithOptionalMedia(parsedRequest.mediaFile, () =>
      prisma.$transaction(async (transaction) => {
        const campaign = await transaction.campaign.create({
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
            excludeAlreadySentDays: dedupeMode === "recent_days" ? excludeAlreadySentDays : null,
            dedupeMode,
            dedupeKey,
            creationKey,
            maxRecipients,
            sendWindowStart: serializeAdvancedSettings(payload.advancedSettings) ?? payload.sendWindowStart?.trim() ?? null,
            sendWindowEnd: payload.sendWindowEnd?.trim() || null
          }
        });

        let insertedRecipientCount = 0;

        for (let index = 0; index < recipientRows.length; index += 500) {
          const insertedBatch = await transaction.campaignRecipient.createMany({
            data: recipientRows.slice(index, index + 500).map((recipient) => ({
              ...recipient,
              campaignId: campaign.id
            })),
            skipDuplicates: true
          });
          insertedRecipientCount += insertedBatch.count;
        }

        const persistedRecipientCount = await transaction.campaignRecipient.count({
          where: {
            instanceId,
            campaignId: campaign.id
          }
        });

        if (
          insertedRecipientCount !== recipientRows.length ||
          persistedRecipientCount !== recipientRows.length
        ) {
          throw new Error(
            `Falha ao materializar destinatarios: esperado=${recipientRows.length} inserido=${persistedRecipientCount}`
          );
        }

        return transaction.campaign.findUniqueOrThrow({
          where: { id: campaign.id },
          include: { targetLabel: true }
        });
      }, { timeout: 30_000 })
    );
  let campaignResult: Awaited<ReturnType<typeof createLabelCampaignWithMedia>>;

  try {
    campaignResult = await createLabelCampaignWithMedia();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicateCampaign = await prisma.campaign.findFirst({
        where: { instanceId, creationKey },
        include: { targetLabel: true }
      });
      if (duplicateCampaign) {
        return NextResponse.json({
          campaign: serializeCampaignForApi(duplicateCampaign),
          idempotent: true,
          message: "Campanha ja criada por esta solicitacao."
        });
      }
    }
    return campaignMediaErrorResponse(error);
  }

  const campaign = campaignResult.campaign;

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
          campaign: serializeCampaignForApi({
            ...campaign,
            ...(campaignResult.media ?? {})
          })
        },
        { status: startResult.reason === "another_campaign_running" ? 409 : 400 }
      );
    }
  }

  return NextResponse.json(
    {
      campaign: serializeCampaignForApi({
        ...campaign,
        ...(campaignResult.media ?? {})
      }),
      audience: {
        total: audience.total,
        eligible: audience.eligible,
        skipped: audience.skipped,
        skippedReasons: audience.skippedReasons,
        jidTypeCounts: audience.jidTypeCounts,
        selected: audience.selected,
        added: audience.selected
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

