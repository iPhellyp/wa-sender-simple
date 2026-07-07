import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";
import { getLastSendByJids, getSendJidSets } from "@/src/lib/labels/send-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationApiFilter = "all" | "contacts" | "with-message" | "without-message" | "labeled";
type SendStatusFilter = "all" | "sent" | "never_sent" | "failed";
type ConversationSort = "recent" | "oldest" | "no_message" | "tagged" | "sent" | "never_sent";

const DEFAULT_TYPE: ConversationApiFilter = "contacts";
const DEFAULT_SEND_STATUS: SendStatusFilter = "all";
const DEFAULT_SORT: ConversationSort = "recent";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const recentOrder: Prisma.WhatsappChatOrderByWithRelationInput[] = [
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
    createdAt: "desc"
  },
  {
    id: "desc"
  }
];

const oldestOrder: Prisma.WhatsappChatOrderByWithRelationInput[] = [
  {
    lastMessageAt: {
      sort: "asc",
      nulls: "last"
    }
  },
  {
    updatedAt: "asc"
  },
  {
    createdAt: "asc"
  },
  {
    id: "asc"
  }
];

function getType(request: NextRequest): ConversationApiFilter {
  const type = request.nextUrl.searchParams.get("type");

  if (
    type === "all" ||
    type === "contacts" ||
    type === "with-message" ||
    type === "without-message" ||
    type === "labeled"
  ) {
    return type;
  }

  return DEFAULT_TYPE;
}

function getSendStatus(request: NextRequest): SendStatusFilter {
  const status = request.nextUrl.searchParams.get("sendStatus");

  if (status === "sent" || status === "never_sent" || status === "failed") {
    return status;
  }

  return DEFAULT_SEND_STATUS;
}

function getSort(request: NextRequest): ConversationSort {
  const sort = request.nextUrl.searchParams.get("sort");

  if (
    sort === "oldest" ||
    sort === "no_message" ||
    sort === "tagged" ||
    sort === "sent" ||
    sort === "never_sent"
  ) {
    return sort;
  }

  return DEFAULT_SORT;
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

function andWhere(...items: Prisma.WhatsappChatWhereInput[]): Prisma.WhatsappChatWhereInput {
  const filters = items.filter((item) => Object.keys(item).length > 0);

  return filters.length > 0 ? { AND: filters } : {};
}

function getScopeWhere(type: ConversationApiFilter): Prisma.WhatsappChatWhereInput {
  const x1Only: Prisma.WhatsappChatWhereInput = {
    isGroup: false
  };

  if (type === "with-message") {
    return andWhere(x1Only, {
      lastMessageAt: {
        not: null
      }
    });
  }

  if (type === "without-message") {
    return andWhere(x1Only, {
      lastMessageAt: null
    });
  }

  if (type === "labeled") {
    return andWhere(x1Only, {
      labels: {
        some: {
          label: {
            deleted: false
          }
        }
      }
    });
  }

  return x1Only;
}

function getLabelWhere(labelId: string): Prisma.WhatsappChatWhereInput {
  return labelId
    ? {
        labels: {
          some: {
            labelId,
            label: {
              deleted: false
            }
          }
        }
      }
    : {};
}

function getSearchWhere(search: string, matchedContactJids: string[]): Prisma.WhatsappChatWhereInput {
  if (!search) {
    return {};
  }

  const filters: Prisma.WhatsappChatWhereInput[] = [
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
  ];

  if (matchedContactJids.length > 0) {
    filters.push({
      jid: {
        in: matchedContactJids
      }
    });
  }

  return {
    OR: filters
  };
}

function getSendStatusWhere(
  status: SendStatusFilter,
  jidSets: Awaited<ReturnType<typeof getSendJidSets>>
): Prisma.WhatsappChatWhereInput {
  if (status === "sent") {
    return jidSets.sentJids.length > 0 ? { jid: { in: jidSets.sentJids } } : { id: { in: [] } };
  }

  if (status === "failed") {
    return jidSets.failedJids.length > 0 ? { jid: { in: jidSets.failedJids } } : { id: { in: [] } };
  }

  if (status === "never_sent") {
    return jidSets.anyRecipientJids.length > 0
      ? { jid: { notIn: jidSets.anyRecipientJids } }
      : {};
  }

  return {};
}

function getPriorityWhere(
  sort: ConversationSort,
  jidSets: Awaited<ReturnType<typeof getSendJidSets>>
) {
  if (sort === "no_message") {
    return {
      first: { lastMessageAt: null },
      second: { lastMessageAt: { not: null } }
    } satisfies { first: Prisma.WhatsappChatWhereInput; second: Prisma.WhatsappChatWhereInput };
  }

  if (sort === "tagged") {
    return {
      first: {
        labels: {
          some: {
            label: {
              deleted: false
            }
          }
        }
      },
      second: {
        labels: {
          none: {
            label: {
              deleted: false
            }
          }
        }
      }
    } satisfies { first: Prisma.WhatsappChatWhereInput; second: Prisma.WhatsappChatWhereInput };
  }

  if (sort === "sent") {
    return {
      first: jidSets.sentJids.length > 0 ? { jid: { in: jidSets.sentJids } } : { id: { in: [] } },
      second: jidSets.sentJids.length > 0 ? { jid: { notIn: jidSets.sentJids } } : {}
    } satisfies { first: Prisma.WhatsappChatWhereInput; second: Prisma.WhatsappChatWhereInput };
  }

  if (sort === "never_sent") {
    return {
      first:
        jidSets.anyRecipientJids.length > 0
          ? { jid: { notIn: jidSets.anyRecipientJids } }
          : {},
      second:
        jidSets.anyRecipientJids.length > 0
          ? { jid: { in: jidSets.anyRecipientJids } }
          : { id: { in: [] } }
    } satisfies { first: Prisma.WhatsappChatWhereInput; second: Prisma.WhatsappChatWhereInput };
  }

  return null;
}

async function fetchRows(options: {
  where: Prisma.WhatsappChatWhereInput;
  sort: ConversationSort;
  skip: number;
  limit: number;
  jidSets: Awaited<ReturnType<typeof getSendJidSets>>;
}) {
  const include = {
    labels: {
      include: {
        label: {
          select: {
            id: true,
            name: true,
            deleted: true
          }
        }
      }
    },
    _count: {
      select: {
        labels: true
      }
    }
  } satisfies Prisma.WhatsappChatInclude;
  type ApiChatRow = Prisma.WhatsappChatGetPayload<{
    include: typeof include;
  }>;

  if (options.sort === "recent" || options.sort === "oldest") {
    return prisma.whatsappChat.findMany({
      where: options.where,
      orderBy: options.sort === "oldest" ? oldestOrder : recentOrder,
      skip: options.skip,
      take: options.limit,
      include
    });
  }

  const priority = getPriorityWhere(options.sort, options.jidSets);

  if (!priority) {
    return [];
  }

  const firstWhere = andWhere(options.where, priority.first);
  const firstCount = await prisma.whatsappChat.count({
    where: firstWhere
  });
  const rows: ApiChatRow[] = [];

  if (options.skip < firstCount) {
    rows.push(
      ...(await prisma.whatsappChat.findMany({
        where: firstWhere,
        orderBy: recentOrder,
        skip: options.skip,
        take: options.limit,
        include
      }))
    );
  }

  if (rows.length < options.limit) {
    rows.push(
      ...(await prisma.whatsappChat.findMany({
        where: andWhere(options.where, priority.second),
        orderBy: recentOrder,
        skip: Math.max(0, options.skip - firstCount),
        take: options.limit - rows.length,
        include
      }))
    );
  }

  return rows;
}

async function findMatchingContactJids(search: string) {
  if (!search) {
    return [];
  }

  const numericSearch = search.replace(/\D/g, "");
  const filters: Prisma.WhatsappContactWhereInput[] = [
    {
      jid: {
        contains: search,
        mode: "insensitive"
      }
    },
    {
      name: {
        contains: search,
        mode: "insensitive"
      }
    },
    {
      pushName: {
        contains: search,
        mode: "insensitive"
      }
    }
  ];

  if (numericSearch) {
    filters.push({
      phone: {
        contains: numericSearch
      }
    });
  }

  const contacts = await prisma.whatsappContact.findMany({
    where: {
      OR: filters
    },
    select: {
      jid: true
    },
    take: 150
  });

  return contacts.map((contact) => contact.jid);
}

export async function GET(request: NextRequest) {
  const type = getType(request);
  const sendStatus = getSendStatus(request);
  const sort = getSort(request);
  const search = (
    request.nextUrl.searchParams.get("search") ??
    request.nextUrl.searchParams.get("q") ??
    ""
  ).trim();
  const labelId = request.nextUrl.searchParams.get("labelId")?.trim() ?? "";
  const page = getPage(request);
  const limit = getLimit(request);
  const skip = (page - 1) * limit;
  const [jidSets, matchedContactJids] = await Promise.all([
    getSendJidSets(),
    findMatchingContactJids(search)
  ]);
  const where = andWhere(
    getScopeWhere(type),
    getSearchWhere(search, matchedContactJids),
    getLabelWhere(labelId),
    getSendStatusWhere(sendStatus, jidSets)
  );

  const [rows, filteredCount, totalChats, withMessageCount, withoutMessageCount, groupIgnoredCount] =
    await Promise.all([
      fetchRows({
        where,
        sort,
        skip,
        limit,
        jidSets
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
          isGroup: true
        }
      })
    ]);

  const contactJids = rows.map((chat) => chat.jid);
  const [contacts, lastSendByJid] = await Promise.all([
    prisma.whatsappContact.findMany({
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
    }),
    getLastSendByJids(contactJids)
  ]);
  const contactByJid = new Map(contacts.map((contact) => [contact.jid, contact]));

  return NextResponse.json({
    type,
    search,
    labelId,
    sendStatus,
    sort,
    pagination: {
      page,
      limit,
      total: filteredCount,
      totalPages: Math.max(1, Math.ceil(filteredCount / limit))
    },
    counts: {
      totalChats,
      contactCount: totalChats,
      groupIgnoredCount,
      withMessageCount,
      withoutMessageCount
    },
    chats: rows.map((chat) => {
      const contact = contactByJid.get(chat.jid);
      const lastSend = lastSendByJid.get(chat.jid);

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
        labels: chat.labels.filter((item) => !item.label.deleted).map((item) => item.label.name),
        lastMessageText: chat.lastMessageText,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        updatedAt: chat.updatedAt.toISOString(),
        sendStatus: lastSend?.status ?? "never_sent",
        sentAt: lastSend?.sentAt?.toISOString() ?? null,
        campaignName: lastSend?.campaignName ?? null,
        error: lastSend?.error ?? null
      };
    })
  });
}
