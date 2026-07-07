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
  return request.nextUrl.searchParams.get("hideGroups") !== "false";
}

function andWhere(...items: Prisma.WhatsappChatWhereInput[]): Prisma.WhatsappChatWhereInput {
  const filters = items.filter((item) => Object.keys(item).length > 0);

  return filters.length > 0 ? { AND: filters } : {};
}

function getScopeWhere(type: ConversationApiFilter, hideGroups: boolean): Prisma.WhatsappChatWhereInput {
  const x1Only: Prisma.WhatsappChatWhereInput = {
    isGroup: false
  };

  if (type === "contacts" || type === "all") {
    return x1Only;
  }

  if (type === "with-message") {
    return andWhere(
      x1Only,
      {
        lastMessageAt: {
          not: null
        }
      }
    );
  }

  if (type === "without-message") {
    return andWhere(
      x1Only,
      {
        lastMessageAt: null
      }
    );
  }

  if (hideGroups) {
    return x1Only;
  }

  return x1Only;
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

  const [rows, filteredCount, totalChats, withMessageCount, withoutMessageCount, contactCount, groupIgnoredCount] =
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
              labels: true
            }
          }
        }
      }),
      prisma.whatsappChat.count({ where }),
      prisma.whatsappChat.count({
        where: {
          isGroup: false
        }
      }),
      prisma.whatsappChat.count({
        where: {
          isGroup: false,
          lastMessageAt: {
            not: null
          }
        }
      }),
      prisma.whatsappChat.count({
        where: {
          isGroup: false,
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
      groupIgnoredCount,
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
        lastMessageText: chat.lastMessageText,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        updatedAt: chat.updatedAt.toISOString()
      };
    })
  });
}
