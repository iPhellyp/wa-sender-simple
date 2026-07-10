import { NextRequest, NextResponse } from "next/server";
import { CampaignRecipientStatus } from "@prisma/client";
import { renderCampaignMessage } from "@/src/lib/campaigns/message-template";
import {
  CampaignMediaError,
  createCampaignWithOptionalMedia,
  parseCampaignCreateRequest,
  serializeCampaignForApi
} from "@/src/lib/campaigns/media";
import { parseCampaignScheduleInput } from "@/src/lib/campaigns/scheduling-input";
import { buildCampaignDedupeKey } from "@/src/lib/labels/audience";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";
import {
  getIndividualWhatsappChatWhere,
  isEligibleIndividualWhatsappChat
} from "@/src/lib/whatsapp/individual-chat-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function countRecipientsByStatus(
  recipients: Array<{
    status: CampaignRecipientStatus;
  }>
) {
  return recipients.reduce<Record<string, number>>((accumulator, recipient) => {
    accumulator[recipient.status] = (accumulator[recipient.status] ?? 0) + 1;
    return accumulator;
  }, {});
}

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

export async function GET(request: NextRequest) {
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const campaigns = await prisma.campaign.findMany({
    where: {
      instanceId
    },
    include: {
      targetLabel: {
        select: {
          id: true,
          name: true,
          color: true
        }
      },
      recipients: {
        where: {
          instanceId
        },
        select: {
          status: true
        }
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  return NextResponse.json({
    instanceId,
    campaigns: campaigns.map((campaign) =>
      serializeCampaignForApi({
        ...campaign,
        recipientCount: campaign.recipients.length,
        recipientStatusCounts: countRecipientsByStatus(campaign.recipients)
      })
    )
  });
}

export async function POST(request: NextRequest) {
  let parsedRequest: Awaited<ReturnType<typeof parseCampaignCreateRequest>>;

  try {
    parsedRequest = await parseCampaignCreateRequest(request);
  } catch (error) {
    return campaignMediaErrorResponse(error);
  }

  const payload = parsedRequest.payload as {
    name?: string;
    defaultMessage?: string | null;
    intervalMinutes?: number;
    maxRecipients?: number;
    advancedSettings?: unknown;
    contactIds?: string[];
    chatIds?: string[];
    instanceId?: string;
    sendMode?: "NOW" | "SCHEDULED";
    scheduledAt?: string | null;
  };
  const instanceId = await getActiveInstanceIdFromSearchOrDefault({
    instanceId: payload.instanceId
  });
  const name = String(payload.name ?? "").trim();
  const defaultMessage = String(payload.defaultMessage ?? "").trim();
  const intervalMinutes = Number(payload.intervalMinutes ?? 0);
  const maxRecipients = Number(payload.maxRecipients ?? 0);
  const requestedMaxRecipients =
    Number.isInteger(maxRecipients) && maxRecipients > 0 ? Math.min(maxRecipients, 500) : null;
  const advancedSettings = serializeAdvancedSettings(payload.advancedSettings);
  const scheduleInput = parseCampaignScheduleInput(payload.sendMode, payload.scheduledAt);
  const contactIds = Array.isArray(payload.contactIds)
    ? Array.from(new Set(payload.contactIds.map((id) => String(id).trim()).filter(Boolean)))
    : [];
  const chatIds = Array.isArray(payload.chatIds) ? payload.chatIds : [];
  const uniqueChatIds = Array.from(new Set(chatIds.map((id) => String(id).trim()).filter(Boolean)));

  if (!name) {
    return NextResponse.json({ error: "Nome da campanha obrigatorio" }, { status: 400 });
  }

  if (!scheduleInput.ok) {
    return NextResponse.json({ error: scheduleInput.error }, { status: 400 });
  }

  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    return NextResponse.json(
      { error: "Intervalo deve ser inteiro e maior ou igual a 1 minuto" },
      { status: 400 }
    );
  }

  if (contactIds.length === 0 && uniqueChatIds.length === 0) {
    return NextResponse.json({ error: "Selecione ao menos um contato" }, { status: 400 });
  }

  if (uniqueChatIds.length > 0) {
    if (!defaultMessage) {
      return NextResponse.json(
        { error: "Mensagem obrigatoria para contatos do WhatsApp" },
        { status: 400 }
      );
    }

    if (defaultMessage.length > 4000) {
      return NextResponse.json({ error: "Mensagem excede 4000 caracteres" }, { status: 400 });
    }

    const chats = await prisma.whatsappChat.findMany({
      where: {
        id: {
          in: uniqueChatIds
        },
        instanceId,
        ...getIndividualWhatsappChatWhere()
      },
      orderBy: {
        name: "asc"
      },
      select: {
        id: true,
        name: true,
        jid: true,
        isGroup: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        lastMessageAt: true,
        lastMessageText: true,
        unreadCount: true
      }
    });

    const individualChats = chats.filter((chat) =>
      isEligibleIndividualWhatsappChat({
        jid: chat.jid,
        isGroup: chat.isGroup,
        lastInboundAt: chat.lastInboundAt,
        lastOutboundAt: chat.lastOutboundAt,
        lastMessageAt: chat.lastMessageAt,
        lastMessageText: chat.lastMessageText,
        unreadCount: chat.unreadCount
      })
    );

    if (individualChats.length === 0) {
      return NextResponse.json(
        { error: "Nenhum contato individual valido selecionado" },
        { status: 400 }
      );
    }

    const dedupeKey = `chatIds:${Date.now()}`;
    try {
      const result = await createCampaignWithOptionalMedia(parsedRequest.mediaFile, () =>
        prisma.campaign.create({
          data: {
            instanceId,
            name,
            defaultMessage,
            intervalMinutes,
            status: scheduleInput.status,
            scheduledAt: scheduleInput.scheduledAt,
            targetMode: "chatIds",
            excludeGroups: true,
            dedupeKey,
            maxRecipients: requestedMaxRecipients ?? individualChats.length,
            sendWindowStart: advancedSettings,
            recipients: {
              create: individualChats.slice(0, requestedMaxRecipients ?? individualChats.length).map((chat) => ({
                instanceId,
                chatId: chat.id,
                jid: chat.jid,
                messageFinal: renderCampaignMessage(defaultMessage, {
                  name: chat.name,
                  source: "contatos-whatsapp"
                }),
                dedupeKey: buildCampaignDedupeKey(dedupeKey, chat.jid)
              }))
            }
          },
          include: {
            recipients: true
          }
        })
      );

      return NextResponse.json(
        serializeCampaignForApi({
          ...result.campaign,
          ...(result.media ?? {})
        }),
        { status: 201 }
      );
    } catch (error) {
      return campaignMediaErrorResponse(error);
    }
  }

  const contacts = await prisma.contact.findMany({
    where: {
      id: {
        in: contactIds
      },
      instanceId,
      optedOut: false
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  const uniqueContactsByPhone = Array.from(
    new Map(contacts.map((contact) => [contact.phoneNormalized, contact])).values()
  ).slice(0, requestedMaxRecipients ?? contacts.length);

  if (uniqueContactsByPhone.length === 0) {
    return NextResponse.json(
      { error: "Nenhum contato valido selecionado ou todos estao opt-out" },
      { status: 400 }
    );
  }

  if (!defaultMessage && uniqueContactsByPhone.some((contact) => !contact.message?.trim())) {
    return NextResponse.json(
      {
        error:
          "Informe mensagem padrao ou selecione apenas contatos com mensagem individual na planilha"
      },
      { status: 400 }
    );
  }

  try {
    const result = await createCampaignWithOptionalMedia(parsedRequest.mediaFile, () =>
      prisma.campaign.create({
        data: {
          instanceId,
          name,
          defaultMessage: defaultMessage || null,
          intervalMinutes,
          status: scheduleInput.status,
          scheduledAt: scheduleInput.scheduledAt,
          maxRecipients: requestedMaxRecipients,
          sendWindowStart: advancedSettings,
          recipients: {
            create: uniqueContactsByPhone.map((contact) => ({
              instanceId,
              contactId: contact.id,
              messageFinal: renderCampaignMessage(defaultMessage || contact.message?.trim() || "", contact)
            }))
          }
        },
        include: {
          recipients: true
        }
      })
    );

    return NextResponse.json(
      serializeCampaignForApi({
        ...result.campaign,
        ...(result.media ?? {})
      }),
      { status: 201 }
    );
  } catch (error) {
    return campaignMediaErrorResponse(error);
  }
}
