import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationApiFilter =
  | "all"
  | "contacts"
  | "groups"
  | "with-message"
  | "without-message";

const DEFAULT_TYPE: ConversationApiFilter = "contacts";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function getType(request: NextRequest): ConversationApiFilter {
  const type = request.nextUrl.searchParams.get("type");

  if (
    type === "all" ||
    type === "contacts" ||
    type === "groups" ||
    type === "with-message" ||
    type === "without-message"
  ) {
    return type;
  }

  return DEFAULT_TYPE;
}

function getPage(request: NextRequest) {
  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getLimit(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);

  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}

function getHideGroups(request: NextRequest) {
  return request.nextUrl.searchParams.get("hideGroups") === "true";
}

function andWhere(...items: Prisma.WhatsappChatWhereInput[]): Prisma.WhatsappChatWhereInput {
  const filters = items.filter((item) => Object.keys(item).length > 0);

  return filters.length > 0 ? { AND: filters } : {};
}

function getScopeWhere(type: ConversationApiFilter, hideGroups: boolean): Prisma.WhatsappChatWhereInput {
  if (type === "contacts") {
    return {
      isGroup: false
    };
  }

  if (type === "groups") {
    return {
      isGroup: true
    };
  }

  if (type === "with-message") {
    return andWhere(
      {
        lastMessageAt: {
          not: null
        }
      },
      hideGroups ? { isGroup: false } : {}
    );
  }

  if (type === "without-message") {
    return andWhere(
      {
        lastMessageAt: null
      },
      hideGroups ? { isGroup: false } : {}
    );
  }

  if (hideGroups) {
    return {
      isGroup: false
    };
  }

  return {};
}

function getSearchWhere(search: string): Prisma.WhatsappChatWhereInput {
  if (!search) {
    return {};
  }

  return {
    OR: [
      {
        name: {
          contains: search,
          mode: "insensitive"
        }
      },
      {
        jid: {
          contains: search,
          mode: "insensitive"
        }
      },
      {
        lastMessageText: {
          contains: search,
          mode: "insensitive"
        }
      }
    ]
  };
}

export async function GET(request: NextRequest) {
  const type = getType(request);
  const search = (
    request.nextUrl.searchParams.get("search") ??
    request.nextUrl.searchParams.get("q") ??
    ""
  ).trim();
  const page = getPage(request);
  const limit = getLimit(request);
  const hideGroups = getHideGroups(request);
  const skip = (page - 1) * limit;
  const where = andWhere(getScopeWhere(type, hideGroups), getSearchWhere(search));

  const [rows, filteredCount, totalChats, withMessageCount, withoutMessageCount, contactCount, groupCount] =
    await Promise.all([
      prisma.whatsappChat.findMany({
        where,
        orderBy: [
          {
            lastMessageAt: {
              sort: "desc",
              nulls: "last"
            }
          },
          {
            updatedAt: "desc"
          },
          {
            id: "desc"
          }
        ],
        skip,
        take: limit,
        include: {
          _count: {
            select: {
              messages: true,
              labels: true
            }
          }
        }
      }),
      prisma.whatsappChat.count({ where }),
      prisma.whatsappChat.count(),
      prisma.whatsappChat.count({
        where: {
          lastMessageAt: {
            not: null
          }
        }
      }),
      prisma.whatsappChat.count({
        where: {
          lastMessageAt: null
        }
      }),
      prisma.whatsappChat.count({
        where: {
          isGroup: false
        }
      }),
      prisma.whatsappChat.count({
        where: {
          isGroup: true
        }
      })
    ]);

  const contactJids = rows.map((chat) => chat.jid);
  const contacts = contactJids.length > 0
    ? await prisma.whatsappContact.findMany({
        where: {
          jid: {
            in: contactJids
          }
        },
        select: {
          jid: true,
          name: true,
          pushName: true
        }
      })
    : [];
  const contactByJid = new Map(contacts.map((contact) => [contact.jid, contact]));

  return NextResponse.json({
    type,
    search,
    hideGroups,
    pagination: {
      page,
      limit,
      total: filteredCount,
      totalPages: Math.max(1, Math.ceil(filteredCount / limit))
    },
    counts: {
      totalChats,
      contactCount,
      groupCount,
      withMessageCount,
      withoutMessageCount
    },
    chats: rows.map((chat) => {
      const contact = contactByJid.get(chat.jid);

      return {
        id: chat.id,
        jid: chat.jid,
        identityLabel: getWhatsappIdentityLabel(chat.jid),
        displayName: getWhatsappDisplayName({
          jid: chat.jid,
          chatName: chat.name,
          contactName: contact?.name,
          contactPushName: contact?.pushName,
          isGroup: chat.isGroup
        }),
        isGroup: chat.isGroup,
        isLid: chat.jid.endsWith("@lid"),
        unreadCount: chat.unreadCount,
        labelCount: chat._count.labels,
        messageCount: chat._count.messages,
        lastMessageText: chat.lastMessageText,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        updatedAt: chat.updatedAt.toISOString()
      };
    })
  });
}
