import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { getLastSendByJids } from "@/src/lib/labels/send-stats";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";
import { getIndividualWhatsappChatWhere } from "@/src/lib/whatsapp/individual-chat-filter";
import { isLidJid, resolveContactDisplay } from "@/src/lib/whatsapp/contact-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getPage(request: NextRequest) {
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getLimit(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");

  if (!Number.isFinite(limit)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 100);
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const page = getPage(request);
  const limit = getLimit(request);
  const skip = (page - 1) * limit;

  const label = await prisma.whatsappLabel.findFirst({
    where: {
      id,
      instanceId,
      deleted: false
    }
  });

  if (!label) {
    return NextResponse.json({ error: "Etiqueta nao encontrada" }, { status: 404 });
  }

  const chatWhere: Prisma.WhatsappChatWhereInput = {
    instanceId,
    ...getIndividualWhatsappChatWhere(),
    ...(search
      ? {
          OR: [
            {
              name: {
                contains: search,
                mode: "insensitive" as const
              }
            },
            {
              jid: {
                contains: search,
                mode: "insensitive" as const
              }
            },
            {
              lastMessageText: {
                contains: search,
                mode: "insensitive" as const
              }
            }
          ]
        }
      : {})
  };
  const associationWhere: Prisma.WhatsappChatLabelWhereInput = {
    instanceId,
    labelId: label.id,
    chat: chatWhere
  };

  const [associations, filteredCount, allContactAssociations, groupCount] = await Promise.all([
    prisma.whatsappChatLabel.findMany({
      where: associationWhere,
      include: {
        chat: true
      },
      orderBy: {
        updatedAt: "desc"
      },
      skip,
      take: limit
    }),
    prisma.whatsappChatLabel.count({
      where: associationWhere
    }),
    prisma.whatsappChatLabel.findMany({
      where: {
        labelId: label.id,
        instanceId,
        chat: {
          instanceId,
          ...getIndividualWhatsappChatWhere()
        }
      },
      select: {
        chat: {
          select: {
            jid: true
          }
        }
      }
    }),
    prisma.whatsappChatLabel.count({
      where: {
        labelId: label.id,
        instanceId,
        chat: {
          instanceId,
          isGroup: true
        }
      }
    })
  ]);

  const visibleJids = associations.map((item) => item.chat.jid);
  const allJids = allContactAssociations.map((item) => item.chat.jid);
  const [contacts, visibleLastSend, allLastSend] = await Promise.all([
    prisma.whatsappContact.findMany({
      where: {
        instanceId,
        jid: {
          in: visibleJids
        }
      },
      select: {
        jid: true,
        name: true,
        pushName: true,
        phone: true
      }
    }),
    getLastSendByJids(visibleJids, instanceId),
    getLastSendByJids(allJids, instanceId)
  ]);
  const contactByJid = new Map(contacts.map((contact) => [contact.jid, contact]));
  const sentCount = Array.from(allLastSend.values()).filter((item) => item.status === "sent").length;
  const failedCount = Array.from(allLastSend.values()).filter((item) => item.status === "failed").length;
  const pendingCount = Array.from(allLastSend.values()).filter((item) => item.status === "pending").length;
  const neverSentCount = Math.max(0, allContactAssociations.length - allLastSend.size);

  return NextResponse.json({
    label: {
      id: label.id,
      waLabelId: label.waLabelId,
      name: label.name,
      color: label.color,
      predefined: label.predefined,
      updatedAt: label.updatedAt
    },
    metrics: {
      conversationCount: allContactAssociations.length,
      contactCount: allContactAssociations.length,
      groupCount,
      sentCount,
      failedCount,
      pendingCount,
      neverSentCount
    },
    pagination: {
      page,
      limit,
      total: filteredCount,
      totalPages: Math.max(1, Math.ceil(filteredCount / limit))
    },
    conversations: associations.map((association) => {
      const chat = association.chat;
      const contact = contactByJid.get(chat.jid);
      const lastSend = visibleLastSend.get(chat.jid);
      const display = resolveContactDisplay({
        jid: chat.jid,
        chatName: chat.name,
        contactName: contact?.name,
        pushName: contact?.pushName,
        phone: contact?.phone
      });
      const isUnresolvedLid =
        isLidJid(chat.jid) &&
        !display.displayPhone &&
        display.displayName === "Contato sem número resolvido";

      return {
        chatId: chat.id,
        jid: chat.jid,
        name: display.displayName,
        displayName: display.displayName,
        displayPhone: display.displayPhone,
        displaySubtitle: display.displaySubtitle,
        rawJid: display.rawJid,
        isEligible: !isUnresolvedLid,
        skippedReason: isUnresolvedLid ? "unresolved_lid" : null,
        isGroup: chat.isGroup,
        lastMessageAt: chat.lastMessageAt,
        updatedAt: chat.updatedAt,
        lastMessageText: chat.lastMessageText,
        sendStatus: lastSend?.status ?? "never_sent",
        sentAt: lastSend?.sentAt ?? null,
        campaignName: lastSend?.campaignName ?? null,
        error: lastSend?.error ?? null
      };
    })
  });
}

