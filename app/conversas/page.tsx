import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";
import { StartConversationForm } from "./StartConversationForm";
import { SyncHistoryButton } from "./SyncHistoryButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationsPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
    type?: string | string[];
    labelId?: string | string[];
    page?: string | string[];
    limit?: string | string[];
  }>;
};

type ConversationFilter = "recent" | "all" | "contacts" | "groups" | "empty";
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [30, 50] as const;

const chatListInclude = {
  _count: {
    select: {
      messages: true
    }
  },
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

type ContactSummary = {
  jid: string;
  name: string | null;
  pushName: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const filterLabels: Record<ConversationFilter, string> = {
  recent: "Recentes",
  all: "Todas",
  contacts: "Contatos",
  groups: "Grupos",
  empty: "Sem mensagem"
};

function formatDate(value: Date | null) {
  return value ? dateFormatter.format(value) : null;
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

function getSearchValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawQuery = searchParams?.q;
  const query = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;

  return query?.trim() ?? "";
}

function getFilterValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawType = searchParams?.type;
  const type = Array.isArray(rawType) ? rawType[0] : rawType;

  if (
    type === "all" ||
    type === "contacts" ||
    type === "groups" ||
    type === "empty" ||
    type === "recent"
  ) {
    return type;
  }

  return "recent";
}

function getLabelIdValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawLabelId = searchParams?.labelId;
  const labelId = Array.isArray(rawLabelId) ? rawLabelId[0] : rawLabelId;
  return labelId?.trim() ?? "";
}

function getPageValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawPage = searchParams?.page;
  const page = Number(Array.isArray(rawPage) ? rawPage[0] : rawPage);

  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getLimitValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawLimit = searchParams?.limit;
  const limit = Number(Array.isArray(rawLimit) ? rawLimit[0] : rawLimit);

  return PAGE_SIZE_OPTIONS.includes(limit as (typeof PAGE_SIZE_OPTIONS)[number])
    ? limit
    : DEFAULT_PAGE_SIZE;
}

function buildFilterHref(
  type: ConversationFilter,
  query: string,
  labelId: string,
  limit: number
) {
  const params = new URLSearchParams();

  if (type !== "recent") {
    params.set("type", type);
  }

  if (query) {
    params.set("q", query);
  }

  if (labelId) {
    params.set("labelId", labelId);
  }

  if (limit !== DEFAULT_PAGE_SIZE) {
    params.set("limit", String(limit));
  }

  const suffix = params.toString();
  return suffix ? `/conversas?${suffix}` : "/conversas";
}

function buildPageHref(
  page: number,
  type: ConversationFilter,
  query: string,
  labelId: string,
  limit: number
) {
  const params = new URLSearchParams();

  if (type !== "recent") {
    params.set("type", type);
  }

  if (query) {
    params.set("q", query);
  }

  if (labelId) {
    params.set("labelId", labelId);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  if (limit !== DEFAULT_PAGE_SIZE) {
    params.set("limit", String(limit));
  }

  const suffix = params.toString();
  return suffix ? `/conversas?${suffix}` : "/conversas";
}

function getAvatarText(name: string, isGroup: boolean) {
  if (isGroup) {
    return "G";
  }

  return name.replace(/\W/g, "").slice(0, 1).toUpperCase() || "#";
}

function andWhere(...items: Prisma.WhatsappChatWhereInput[]): Prisma.WhatsappChatWhereInput {
  const filters = items.filter((item) => Object.keys(item).length > 0);

  if (filters.length === 0) {
    return {};
  }

  return {
    AND: filters
  } satisfies Prisma.WhatsappChatWhereInput;
}

function getLabelWhere(labelId: string): Prisma.WhatsappChatWhereInput {
  if (!labelId) {
    return {};
  }

  return {
    labels: {
      some: {
        labelId,
        label: {
          deleted: false
        }
      }
    }
  };
}

function getScopeWhere(type: ConversationFilter): Prisma.WhatsappChatWhereInput {
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

  if (type === "empty") {
    return {
      messages: {
        none: {}
      }
    };
  }

  if (type === "recent") {
    return {
      messages: {
        some: {}
      }
    };
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

function getFilterCount(type: ConversationFilter, counts: {
  totalChats: number;
  withMessagesCount: number;
  individualCount: number;
  groupCount: number;
  emptyCount: number;
}) {
  if (type === "all") {
    return counts.totalChats;
  }

  if (type === "contacts") {
    return counts.individualCount;
  }

  if (type === "groups") {
    return counts.groupCount;
  }

  if (type === "empty") {
    return counts.emptyCount;
  }

  return counts.withMessagesCount;
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = getSearchValue(resolvedSearchParams);
  const type = getFilterValue(resolvedSearchParams);
  const labelId = getLabelIdValue(resolvedSearchParams);
  const page = getPageValue(resolvedSearchParams);
  const limit = getLimitValue(resolvedSearchParams);
  const skip = (page - 1) * limit;
  const matchedContactJids = await findMatchingContactJids(query);
  const where = andWhere(
    getScopeWhere(type),
    getSearchWhere(query, matchedContactJids),
    getLabelWhere(labelId)
  );

  const [
    labels,
    chats,
    filteredCount,
    totalChats,
    withMessagesCount,
    individualCount,
    groupCount,
    emptyCount
  ] =
    await Promise.all([
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
          isGroup: "desc"
        },
        {
          updatedAt: "desc"
        }
      ],
      skip,
      take: limit,
      include: chatListInclude
    }),
    prisma.whatsappChat.count({
      where
    }),
    prisma.whatsappChat.count(),
    prisma.whatsappChat.count({
      where: {
        messages: {
          some: {}
        }
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
    }),
    prisma.whatsappChat.count({
      where: {
        messages: {
          none: {}
        }
      }
    })
  ]);

  const chatJids = chats.map((chat) => chat.jid);
  const contacts = chatJids.length > 0
    ? await prisma.whatsappContact.findMany({
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
      })
    : [];
  const contactByJid = new Map<string, ContactSummary>(
    contacts.map((contact) => [contact.jid, contact])
  );
  const counts = {
    totalChats,
    withMessagesCount,
    individualCount,
    groupCount,
    emptyCount
  };
  const totalPages = Math.max(1, Math.ceil(filteredCount / limit));
  const firstVisible = chats.length === 0 ? 0 : skip + 1;
  const lastVisible = Math.min(skip + chats.length, filteredCount);

  return (
    <AppShell title="Inbox WhatsApp">
      <section className="inbox-page">
        <div className="inbox-hero">
          <div>
            <p className="page-subtitle">
              {withMessagesCount} conversas com mensagens, {emptyCount} contatos sem mensagem salva
            </p>
            <p className="muted">
              Alguns contatos podem aparecer sem nome ou mensagem porque o WhatsApp nem sempre envia todo
              o historico para sessao ja pareada. Use a verificacao manual sem resetar a conexao atual.
            </p>
          </div>
          <div className="inbox-actions">
            <StartConversationForm />
            <SyncHistoryButton />
          </div>
        </div>

        <div className="inbox-metrics">
          <article className="metric-card">
            <span>Total conversas</span>
            <strong>{totalChats}</strong>
          </article>
          <article className="metric-card">
            <span>Com mensagem</span>
            <strong>{withMessagesCount}</strong>
          </article>
          <article className="metric-card">
            <span>Contatos individuais</span>
            <strong>{individualCount}</strong>
          </article>
          <article className="metric-card">
            <span>Grupos</span>
            <strong>{groupCount}</strong>
          </article>
          <article className="metric-card">
            <span>Sem mensagem</span>
            <strong>{emptyCount}</strong>
          </article>
        </div>

        <div className="inbox-toolbar">
          <nav className="segmented" aria-label="Filtros de conversas">
            {(Object.keys(filterLabels) as ConversationFilter[]).map((filter) => (
              <Link
                className={type === filter ? "active" : ""}
                href={buildFilterHref(filter, query, labelId, limit)}
                key={filter}
              >
                {filterLabels[filter]}
                <span>{getFilterCount(filter, counts)}</span>
              </Link>
            ))}
          </nav>

          <form action="/conversas" className="inbox-search" method="get">
            {type !== "recent" ? <input name="type" type="hidden" value={type} /> : null}
            <input
              className="input"
              defaultValue={query}
              name="q"
              placeholder="Buscar por nome, telefone, JID ou ultima mensagem"
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
            <select className="input" defaultValue={String(limit)} name="limit">
              {PAGE_SIZE_OPTIONS.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize} por pagina
                </option>
              ))}
            </select>
            <button className="button" type="submit">
              Buscar
            </button>
          </form>
        </div>

        {type !== "empty" && emptyCount > 0 ? (
          <div className="empty-hint">
            A inbox abre em Recentes para evitar uma lista poluida. Use o filtro Sem mensagem para ver
            contatos sincronizados sem historico salvo.
          </div>
        ) : null}

        {chats.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma conversa encontrada.</strong>
            <span>Altere o filtro, sincronize o historico ou inicie uma conversa por telefone.</span>
          </div>
        ) : (
          <div className="conversation-grid">
            {chats.map((chat) => {
              const contact = contactByJid.get(chat.jid);
              const name = getWhatsappDisplayName({
                jid: chat.jid,
                chatName: chat.name,
                contactName: contact?.name,
                contactPushName: contact?.pushName,
                isGroup: chat.isGroup
              });
              const hasMessages = chat._count.messages > 0 || Boolean(chat.lastMessageText);
              const date = formatDate(chat.lastMessageAt);
              const lastDirection = getLastDirection(chat);

              return (
                <Link className="inbox-conversation-card" href={`/conversas/${chat.id}`} key={chat.id}>
                  <span className={`conversation-avatar ${chat.isGroup ? "group" : ""}`}>
                    {getAvatarText(name, chat.isGroup)}
                  </span>
                  <span className="conversation-card-body">
                    <span className="conversation-card-top">
                      <span className="conversation-title-block">
                        <strong>{name}</strong>
                        <span>{getWhatsappIdentityLabel(chat.jid)}</span>
                      </span>
                      {date ? <span className="conversation-time">{date}</span> : null}
                    </span>
                    <span className="conversation-card-meta">
                      <span className={`badge ${chat.isGroup ? "info" : "success"}`}>
                        {chat.isGroup ? "grupo" : "contato"}
                      </span>
                      {chat.labels
                        .filter((item) => !item.label.deleted)
                        .slice(0, 3)
                        .map((item) => (
                          <span className="label-badge" key={item.id}>
                            {item.label.name}
                          </span>
                        ))}
                      {!hasMessages ? <span className="badge warning">sem mensagem</span> : null}
                      {lastDirection ? <span>{lastDirection}</span> : null}
                      {chat._count.messages > 0 ? <span>{chat._count.messages} mensagens</span> : null}
                      {chat.unreadCount > 0 ? <span>{chat.unreadCount} nao lidas</span> : null}
                    </span>
                    {hasMessages ? (
                      <span className="conversation-preview">{chat.lastMessageText ?? "Mensagem salva"}</span>
                    ) : (
                      <span className="conversation-preview empty">
                        Contato sincronizado, sem mensagens salvas
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <span className="muted">
            Exibindo {firstVisible}-{lastVisible} de {filteredCount} conversas filtradas
          </span>
          <div className="button-row">
            {page > 1 ? (
              <Link
                className="button secondary"
                href={buildPageHref(page - 1, type, query, labelId, limit)}
              >
                Anterior
              </Link>
            ) : (
              <span className="button secondary" style={{ opacity: 0.55 }}>
                Anterior
              </span>
            )}
            <span className="muted">
              Pagina {page} de {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                className="button secondary"
                href={buildPageHref(page + 1, type, query, labelId, limit)}
              >
                Proxima
              </Link>
            ) : (
              <span className="button secondary" style={{ opacity: 0.55 }}>
                Proxima
              </span>
            )}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
