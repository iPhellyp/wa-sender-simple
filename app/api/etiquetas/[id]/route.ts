import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { getWhatsappDisplayName } from "@/src/lib/whatsapp/display-name";
import { getLastSendByJids } from "@/src/lib/labels/send-stats";

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
  const page = getPage(request);
  const limit = getLimit(request);
  const skip = (page - 1) * limit;

  const label = await prisma.whatsappLabel.findFirst({
    where: {
      id,
      deleted: false
    }
  });

  if (!label) {
    return NextResponse.json({ error: "Etiqueta nao encontrada" }, { status: 404 });
  }

  const chatWhere: Prisma.WhatsappChatWhereInput = {
    isGroup: false,
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
        chat: {
          isGroup: false
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
        chat: {
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
        jid: {
          in: visibleJids
        }
      },
      select: {
        jid: true,
        name: true,
        pushName: true
      }
    }),
    getLastSendByJids(visibleJids),
    getLastSendByJids(allJids)
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
      const name = getWhatsappDisplayName({
        jid: chat.jid,
        chatName: chat.name,
        contactName: contact?.name,
        contactPushName: contact?.pushName,
        isGroup: chat.isGroup
      });

      return {
        chatId: chat.id,
        jid: chat.jid,
        name,
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
