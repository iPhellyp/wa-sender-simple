import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AppShell } from "@/app/components/AppShell";
import { StatCard } from "@/app/components/ui/StatCard";
import { prisma } from "@/src/lib/prisma/client";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";
import { getLastSendByJids, getSendJidSets } from "@/src/lib/labels/send-stats";
import { CatalogSelectionClient, type CatalogConversationItem } from "./CatalogSelectionClient";
import { StartConversationForm } from "./StartConversationForm";
import { SyncHistoryButton } from "./SyncHistoryButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationsPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
    type?: string | string[];
    labelId?: string | string[];
    sendStatus?: string | string[];
    sort?: string | string[];
    page?: string | string[];
    limit?: string | string[];
  }>;
};

type ConversationFilter = "all" | "contacts" | "with-message" | "without-message" | "labeled";
type SendStatusFilter = "all" | "sent" | "never_sent" | "failed";
type ConversationSort = "recent" | "oldest" | "no_message" | "tagged" | "sent" | "never_sent";

const DEFAULT_FILTER: ConversationFilter = "contacts";
const DEFAULT_SEND_STATUS: SendStatusFilter = "all";
const DEFAULT_SORT: ConversationSort = "recent";
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [30, 50] as const;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const filterLabels: Record<ConversationFilter, string> = {
  all: "Todos X1",
  contacts: "Contatos",
  "with-message": "Com mensagem",
  "without-message": "Sem mensagem",
  labeled: "Etiquetados"
};

const sendStatusLabels: Record<SendStatusFilter, string> = {
  all: "Todos envios",
  sent: "Já enviado",
  never_sent: "Nunca enviado",
  failed: "Com falha"
};

const sortLabels: Record<ConversationSort, string> = {
  recent: "Mais recentes primeiro",
  oldest: "Mais antigos primeiro",
  no_message: "Sem mensagem primeiro",
  tagged: "Etiquetados primeiro",
  sent: "Já enviados primeiro",
  never_sent: "Nunca enviados primeiro"
};

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

const chatInclude = {
  labels: {
    include: {
      label: {
        select: {
          id: true,
          name: true,
          color: true,
          deleted: true
        }
      }
    }
  }
} satisfies Prisma.WhatsappChatInclude;

type ChatRow = Prisma.WhatsappChatGetPayload<{
  include: typeof chatInclude;
}>;

type ContactSummary = {
  jid: string;
  name: string | null;
  pushName: string | null;
};

function pickSingle(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: Date | null | undefined) {
  return value ? dateFormatter.format(value) : "Sem registro";
}

function getSearchValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  return pickSingle(searchParams?.q)?.trim() ?? "";
}

function getFilterValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>): ConversationFilter {
  const type = pickSingle(searchParams?.type);

  if (type === "recent") {
    return "with-message";
  }

  if (type === "empty") {
    return "without-message";
  }

  if (
    type === "all" ||
    type === "contacts" ||
    type === "with-message" ||
    type === "without-message" ||
    type === "labeled"
  ) {
    return type;
  }

  return DEFAULT_FILTER;
}

function getSendStatusValue(
  searchParams: Awaited<ConversationsPageProps["searchParams"]>
): SendStatusFilter {
  const value = pickSingle(searchParams?.sendStatus);

  if (value === "sent" || value === "never_sent" || value === "failed") {
    return value;
  }

  return DEFAULT_SEND_STATUS;
}

function getSortValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>): ConversationSort {
  const value = pickSingle(searchParams?.sort);

  if (
    value === "oldest" ||
    value === "no_message" ||
    value === "tagged" ||
    value === "sent" ||
    value === "never_sent"
  ) {
    return value;
  }

  return DEFAULT_SORT;
}

function getLabelIdValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  return pickSingle(searchParams?.labelId)?.trim() ?? "";
}

function getPageValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const page = Number(pickSingle(searchParams?.page));

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getLimitValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const limit = Number(pickSingle(searchParams?.limit));

  return PAGE_SIZE_OPTIONS.includes(limit as (typeof PAGE_SIZE_OPTIONS)[number])
    ? limit
    : DEFAULT_PAGE_SIZE;
}

function buildHref(options: {
  type: ConversationFilter;
  query: string;
  labelId: string;
  sendStatus: SendStatusFilter;
  sort: ConversationSort;
  page?: number;
  limit: number;
}) {
  const params = new URLSearchParams();

  if (options.type !== DEFAULT_FILTER) {
    params.set("type", options.type);
  }

  if (options.query) {
    params.set("q", options.query);
  }

  if (options.labelId) {
    params.set("labelId", options.labelId);
  }

  if (options.sendStatus !== DEFAULT_SEND_STATUS) {
    params.set("sendStatus", options.sendStatus);
  }

  if (options.sort !== DEFAULT_SORT) {
    params.set("sort", options.sort);
  }

  if (options.page && options.page > 1) {
    params.set("page", String(options.page));
  }

  if (options.limit !== DEFAULT_PAGE_SIZE) {
    params.set("limit", String(options.limit));
  }

  const suffix = params.toString();
  return suffix ? `/conversas?${suffix}` : "/conversas";
}

function andWhere(...items: Prisma.WhatsappChatWhereInput[]): Prisma.WhatsappChatWhereInput {
  const filters = items.filter((item) => Object.keys(item).length > 0);

  return filters.length > 0 ? { AND: filters } : {};
}

function getScopeWhere(type: ConversationFilter): Prisma.WhatsappChatWhereInput {
  const x1Only: Prisma.WhatsappChatWhereInput = {
    isGroup: false
  };

  if (type === "without-message") {
    return andWhere(x1Only, {
      lastMessageAt: null
    });
  }

  if (type === "with-message") {
    return andWhere(x1Only, {
      lastMessageAt: {
        not: null
      }
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

function getSendStatusWhere(
  sendStatus: SendStatusFilter,
  jidSets: Awaited<ReturnType<typeof getSendJidSets>>
): Prisma.WhatsappChatWhereInput {
  if (sendStatus === "sent") {
    return jidSets.sentJids.length > 0 ? { jid: { in: jidSets.sentJids } } : { id: { in: [] } };
  }

  if (sendStatus === "failed") {
    return jidSets.failedJids.length > 0 ? { jid: { in: jidSets.failedJids } } : { id: { in: [] } };
  }

  if (sendStatus === "never_sent") {
    return jidSets.anyRecipientJids.length > 0
      ? { jid: { notIn: jidSets.anyRecipientJids } }
      : {};
  }

  return {};
}

function getSearchWhere(query: string, matchedContactJids: string[]): Prisma.WhatsappChatWhereInput {
  if (!query) {
    return {};
  }

  const filters: Prisma.WhatsappChatWhereInput[] = [
    {
      name: {
        contains: query,
        mode: "insensitive"
      }
    },
    {
      jid: {
        contains: query,
        mode: "insensitive"
      }
    },
    {
      lastMessageText: {
        contains: query,
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

async function findMatchingContactJids(query: string) {
  if (!query) {
    return [];
  }

  const numericQuery = query.replace(/\D/g, "");
  const filters: Prisma.WhatsappContactWhereInput[] = [
    {
      jid: {
        contains: query,
        mode: "insensitive"
      }
    },
    {
      name: {
        contains: query,
        mode: "insensitive"
      }
    },
    {
      pushName: {
        contains: query,
        mode: "insensitive"
      }
    }
  ];

  if (numericQuery) {
    filters.push({
      phone: {
        contains: numericQuery
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

async function fetchPagedChats(options: {
  where: Prisma.WhatsappChatWhereInput;
  sort: ConversationSort;
  skip: number;
  limit: number;
  jidSets: Awaited<ReturnType<typeof getSendJidSets>>;
}) {
  if (options.sort === "recent" || options.sort === "oldest") {
    return prisma.whatsappChat.findMany({
      where: options.where,
      orderBy: options.sort === "oldest" ? oldestOrder : recentOrder,
      skip: options.skip,
      take: options.limit,
      include: chatInclude
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
  const rows: ChatRow[] = [];

  if (options.skip < firstCount) {
    rows.push(
      ...(await prisma.whatsappChat.findMany({
        where: firstWhere,
        orderBy: recentOrder,
        skip: options.skip,
        take: options.limit,
        include: chatInclude
      }))
    );
  }

  if (rows.length < options.limit) {
    const secondWhere = andWhere(options.where, priority.second);
    rows.push(
      ...(await prisma.whatsappChat.findMany({
        where: secondWhere,
        orderBy: recentOrder,
        skip: Math.max(0, options.skip - firstCount),
        take: options.limit - rows.length,
        include: chatInclude
      }))
    );
  }

  return rows;
}

function getAvatarText(name: string) {
  return name.replace(/\W/g, "").slice(0, 1).toUpperCase() || "#";
}

function getLastDirection(chat: {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}) {
  if (chat.lastOutboundAt && (!chat.lastInboundAt || chat.lastOutboundAt >= chat.lastInboundAt)) {
    return "Eu";
  }

  if (chat.lastInboundAt) {
    return "Contato";
  }

  return null;
}

function getFilterCount(type: ConversationFilter, counts: {
  totalX1Chats: number;
  withMessageCount: number;
  withoutMessageCount: number;
  labeledCount: number;
}) {
  if (type === "with-message") {
    return counts.withMessageCount;
  }

  if (type === "without-message") {
    return counts.withoutMessageCount;
  }

  if (type === "labeled") {
    return counts.labeledCount;
  }

  return counts.totalX1Chats;
}

function getSendStatusLabel(status: CatalogConversationItem["sendStatus"]) {
  if (status === "sent") {
    return "já enviado";
  }

  if (status === "failed") {
    return "falhou";
  }

  if (status === "pending") {
    return "pendente";
  }

  return "nunca enviado";
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = getSearchValue(resolvedSearchParams);
  const type = getFilterValue(resolvedSearchParams);
  const sendStatus = getSendStatusValue(resolvedSearchParams);
  const sort = getSortValue(resolvedSearchParams);
  const labelId = getLabelIdValue(resolvedSearchParams);
  const page = getPageValue(resolvedSearchParams);
  const limit = getLimitValue(resolvedSearchParams);
  const skip = (page - 1) * limit;
  const [matchedContactJids, jidSets] = await Promise.all([
    findMatchingContactJids(query),
    getSendJidSets()
  ]);
  const where = andWhere(
    getScopeWhere(type),
    getSearchWhere(query, matchedContactJids),
    getLabelWhere(labelId),
    getSendStatusWhere(sendStatus, jidSets)
  );

  const [
    labels,
    chats,
    filteredCount,
    totalX1Chats,
    withMessageCount,
    withoutMessageCount,
    labeledCount,
    sentChatCount,
    failedChatCount,
    whatsappSession
  ] = await Promise.all([
    prisma.whatsappLabel.findMany({
      where: {
        deleted: false
      },
      orderBy: {
        name: "asc"
      },
      select: {
        id: true,
        name: true
      }
    }),
    fetchPagedChats({
      where,
      sort,
      skip,
      limit,
      jidSets
    }),
    prisma.whatsappChat.count({
      where
    }),
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
        isGroup: false,
        labels: {
          some: {
            label: {
              deleted: false
            }
          }
        }
      }
    }),
    jidSets.sentJids.length > 0
      ? prisma.whatsappChat.count({
          where: {
            isGroup: false,
            jid: {
              in: jidSets.sentJids
            }
          }
        })
      : Promise.resolve(0),
    jidSets.failedJids.length > 0
      ? prisma.whatsappChat.count({
          where: {
            isGroup: false,
            jid: {
              in: jidSets.failedJids
            }
          }
        })
      : Promise.resolve(0),
    getWhatsappStatusPayload()
  ]);

  const chatJids = chats.map((chat) => chat.jid);
  const [contacts, lastSendByJid] = await Promise.all([
    prisma.whatsappContact.findMany({
      where: {
        jid: {
          in: chatJids
        }
      },
      select: {
        jid: true,
        name: true,
        pushName: true
      }
    }),
    getLastSendByJids(chatJids)
  ]);
  const contactByJid = new Map<string, ContactSummary>(
    contacts.map((contact) => [contact.jid, contact])
  );
  const neverSentCount =
    jidSets.anyRecipientJids.length > 0
      ? await prisma.whatsappChat.count({
          where: {
            isGroup: false,
            jid: {
              notIn: jidSets.anyRecipientJids
            }
          }
        })
      : totalX1Chats;
  const counts = {
    totalX1Chats,
    withMessageCount,
    withoutMessageCount,
    labeledCount
  };
  const totalPages = Math.max(1, Math.ceil(filteredCount / limit));
  const firstVisible = chats.length === 0 ? 0 : skip + 1;
  const lastVisible = Math.min(skip + chats.length, filteredCount);
  const items: CatalogConversationItem[] = chats.map((chat) => {
    const contact = contactByJid.get(chat.jid);
    const name = getWhatsappDisplayName({
      jid: chat.jid,
      chatName: chat.name,
      contactName: contact?.name,
      contactPushName: contact?.pushName,
      isGroup: chat.isGroup
    });
    const lastSend = lastSendByJid.get(chat.jid);
    const sendState = lastSend?.status ?? "never_sent";
    const sortDate = chat.lastMessageAt ?? chat.updatedAt;
    const activeLabels = chat.labels.filter((item) => !item.label.deleted);

    return {
      id: chat.id,
      href: `/conversas/${chat.id}`,
      displayName: name,
      identityLabel: getWhatsappIdentityLabel(chat.jid),
      avatarText: getAvatarText(name),
      jid: chat.jid,
      isLid: chat.jid.endsWith("@lid"),
      labels: activeLabels.map((item) => item.label.name),
      preview: chat.lastMessageText ?? "",
      hasMessage: Boolean(chat.lastMessageAt || chat.lastMessageText),
      lastDirection: getLastDirection(chat),
      unreadCount: chat.unreadCount,
      sortDateLabel: formatDate(sortDate),
      sortSource: chat.lastMessageAt ? "message" : "update",
      sendStatus: sendState,
      sendStatusLabel: getSendStatusLabel(sendState),
      sentAtLabel: lastSend?.sentAt ? formatDate(lastSend.sentAt) : null,
      campaignName: lastSend?.campaignName ?? null,
      error: sendState === "failed" ? lastSend?.error ?? null : null
    };
  });

  return (
    <AppShell
      title="Conversas"
      subtitle="Contatos individuais sincronizados do WhatsApp. Grupos, broadcasts e newsletters são ignorados."
    >
      <section className="inbox-page">
        <div className="inbox-hero">
          <div>
            <p className="page-subtitle">
              {filteredCount} contato(s) neste filtro, ordenados por {sortLabels[sort].toLowerCase()}.
            </p>
            <p className="muted">
              Conexão: {whatsappSession.status}. Alguns contatos sem mensagem são ordenados pela
              última atualização disponível.
            </p>
          </div>
          <div className="inbox-actions">
            <StartConversationForm />
            <SyncHistoryButton />
          </div>
        </div>

        <div className="inbox-metrics">
          <StatCard label="Contatos individuais" value={totalX1Chats} helper="Conversas sincronizadas" />
          <StatCard label="Com mensagem" value={withMessageCount} helper="Possuem lastMessageAt" />
          <StatCard label="Sem mensagem" value={withoutMessageCount} helper="Ordenados por atualização" />
          <StatCard label="Etiquetados" value={labeledCount} helper="Com ao menos uma etiqueta" />
          <StatCard label="Já enviados" value={sentChatCount} helper="Via CampaignRecipient" tone="success" />
          <StatCard label="Nunca enviados" value={neverSentCount} helper="Sem destinatário criado" />
          <StatCard label="Com falha" value={failedChatCount} helper="Falha em campanha" tone="warning" />
        </div>

        <div className="inbox-toolbar catalog-toolbar">
          <nav className="segmented" aria-label="Filtros de mensagem">
            {(Object.keys(filterLabels) as ConversationFilter[]).map((filter) => (
              <Link
                className={type === filter ? "active" : ""}
                href={buildHref({ type: filter, query, labelId, sendStatus, sort, limit })}
                key={filter}
              >
                {filterLabels[filter]}
                <span>{getFilterCount(filter, counts)}</span>
              </Link>
            ))}
          </nav>
          <form action="/conversas" className="catalog-filter-form" method="get">
            <input
              className="input"
              defaultValue={query}
              name="q"
              placeholder="Buscar por nome, telefone ou JID"
              type="search"
            />
            <select className="input" defaultValue={labelId} name="labelId">
              <option value="">Todas etiquetas</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
            <select className="input" defaultValue={sendStatus} name="sendStatus">
              {(Object.keys(sendStatusLabels) as SendStatusFilter[]).map((status) => (
                <option key={status} value={status}>
                  {sendStatusLabels[status]}
                </option>
              ))}
            </select>
            <select className="input" defaultValue={type} name="type">
              {(Object.keys(filterLabels) as ConversationFilter[]).map((filter) => (
                <option key={filter} value={filter}>
                  {filterLabels[filter]}
                </option>
              ))}
            </select>
            <select className="input" defaultValue={sort} name="sort">
              {(Object.keys(sortLabels) as ConversationSort[]).map((sortOption) => (
                <option key={sortOption} value={sortOption}>
                  {sortLabels[sortOption]}
                </option>
              ))}
            </select>
            <select className="input" defaultValue={String(limit)} name="limit">
              {PAGE_SIZE_OPTIONS.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize} por página
                </option>
              ))}
            </select>
            <button className="button" type="submit">
              Aplicar
            </button>
          </form>
        </div>

        {withoutMessageCount > 0 ? (
          <div className="message">
            Alguns contatos sem mensagem são ordenados pela última atualização disponível porque o
            modo rápido não salva histórico pesado.
          </div>
        ) : null}

        {chats.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhum contato encontrado.</strong>
            <span>Altere filtros, sincronize o catálogo ou inicie uma conversa por telefone.</span>
          </div>
        ) : (
          <CatalogSelectionClient items={items} />
        )}

        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <span className="muted">
            Exibindo {firstVisible}-{lastVisible} de {filteredCount} contato(s)
          </span>
          <div className="button-row">
            {page > 1 ? (
              <Link
                className="button secondary"
                href={buildHref({ type, query, labelId, sendStatus, sort, page: page - 1, limit })}
              >
                Anterior
              </Link>
            ) : (
              <span className="button secondary" style={{ opacity: 0.55 }}>
                Anterior
              </span>
            )}
            <span className="muted">
              Página {page} de {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                className="button secondary"
                href={buildHref({ type, query, labelId, sendStatus, sort, page: page + 1, limit })}
              >
                Próxima
              </Link>
            ) : (
              <span className="button secondary" style={{ opacity: 0.55 }}>
                Próxima
              </span>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
