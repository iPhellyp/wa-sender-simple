import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";
import { resolveContactDisplay } from "@/src/lib/whatsapp/contact-display";
import { serializeCampaignForApi } from "@/src/lib/campaigns/media";
import {
  emptyRecipientStatusSummary,
  getCampaignRecipientCountMap,
  totalRecipientCount
} from "@/src/lib/campaigns/recipient-counts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const requestedPage = Number(request.nextUrl.searchParams.get("page") ?? 1);
  const requestedPageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? 25);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const pageSize = Number.isInteger(requestedPageSize)
    ? Math.min(100, Math.max(10, requestedPageSize))
    : 25;

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
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
        orderBy: {
          createdAt: "asc"
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phoneNormalized: true,
              optedOut: true
            }
          }
        }
      }
    }
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 });
  }
  const countMap = await getCampaignRecipientCountMap(instanceId, [campaign.id]);
  const recipientSummary = countMap.get(campaign.id) ?? emptyRecipientStatusSummary();
  const recipientTotal = totalRecipientCount(recipientSummary);

  const jids = Array.from(
    new Set(campaign.recipients.map((recipient) => recipient.jid?.trim()).filter((jid): jid is string => Boolean(jid)))
  );
  const chatIds = Array.from(
    new Set(
      campaign.recipients.map((recipient) => recipient.chatId?.trim()).filter((chatId): chatId is string => Boolean(chatId))
    )
  );
  const [whatsappContacts, whatsappChatsByJid, whatsappChatsById] = await Promise.all([
    jids.length
      ? prisma.whatsappContact.findMany({
          where: {
            instanceId,
            jid: {
              in: jids
            }
          },
          select: {
            jid: true,
            phone: true,
            name: true,
            pushName: true
          }
        })
      : Promise.resolve([]),
    jids.length
      ? prisma.whatsappChat.findMany({
          where: {
            instanceId,
            jid: {
              in: jids
            }
          },
          select: {
            id: true,
            jid: true,
            name: true
          }
        })
      : Promise.resolve([]),
    chatIds.length
      ? prisma.whatsappChat.findMany({
          where: {
            instanceId,
            id: {
              in: chatIds
            }
          },
          select: {
            id: true,
            jid: true,
            name: true
          }
        })
      : Promise.resolve([])
  ]);
  const whatsappContactByJid = new Map(whatsappContacts.map((contact) => [contact.jid, contact]));
  const whatsappChatByJid = new Map(whatsappChatsByJid.map((chat) => [chat.jid, chat]));
  const whatsappChatById = new Map(whatsappChatsById.map((chat) => [chat.id, chat]));
  const recipients = campaign.recipients.map((recipient) => {
    const jid = recipient.jid ?? "";
    const whatsappContact = whatsappContactByJid.get(jid);
    const whatsappChat = whatsappChatById.get(recipient.chatId ?? "") ?? whatsappChatByJid.get(jid);
    const effectiveJid = jid || whatsappChat?.jid || "";
    const display = resolveContactDisplay({
      jid: effectiveJid,
      contactName: recipient.contact?.name,
      phoneNormalized: recipient.contact?.phoneNormalized,
      chatName: whatsappChat?.name,
      name: whatsappContact?.name,
      pushName: whatsappContact?.pushName,
      phone: whatsappContact?.phone
    });

    return {
      ...recipient,
      ...display
    };
  });

  return NextResponse.json({
    campaign: {
      ...serializeCampaignForApi(campaign),
      recipients,
      recipientSummary,
      recipientPagination: {
        page,
        pageSize,
        total: recipientTotal,
        totalPages: Math.max(1, Math.ceil(recipientTotal / pageSize))
      }
    }
  });
}
