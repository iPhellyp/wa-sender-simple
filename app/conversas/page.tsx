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
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";

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

type ConversationFilter =
  | "all"
  | "contacts"
  | "with-message"
  | "without-message"
  | "labeled";
const DEFAULT_FILTER: ConversationFilter = "contacts";
const DEFAULT_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [30, 50] as const;

const chatListInclude = {
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
  all: "Todos",
  contacts: "Contatos",
  "with-message": "Com mensagem",
  "without-message": "Sem mensagem",
  labeled: "Etiquetados"
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

  if (type !== DEFAULT_FILTER) {
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

  if (type !== DEFAULT_FILTER) {
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
  const x1Only: Prisma.WhatsappChatWhereInput = {
    isGroup: false
  };

  if (type === "contacts" || type === "all") {
    return x1Only;
  }

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
  totalX1Chats: number;
  withMessageCount: number;
  individualCount: number;
  withoutMessageCount: number;
  labeledCount: number;
}) {
  if (type === "all") {
    return counts.totalX1Chats;
  }

  if (type === "contacts") {
    return counts.individualCount;
  }

  if (type === "without-message") {
    return counts.withoutMessageCount;
  }

  if (type === "labeled") {
    return counts.labeledCount;
  }

  return counts.withMessageCount;
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
    totalX1Chats,
    withMessageCount,
    individualCount,
    withoutMessageCount,
    labeledCount,
    whatsappSession
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
          updatedAt: "desc"
        },
        {
          id: "desc"
        }
      ],
      skip,
      take: limit,
      include: chatListInclude
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
        isGroup: false
      }
    }),
    prisma.whatsappChat.count({
      where: {
        lastMessageAt: null,
        isGroup: false
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
    getWhatsappStatusPayload()
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
    totalX1Chats,
    withMessageCount,
    individualCount,
    withoutMessageCount,
    labeledCount
  };
  const totalPages = Math.max(1, Math.ceil(filteredCount / limit));
  const firstVisible = chats.length === 0 ? 0 : skip + 1;
  const lastVisible = Math.min(skip + chats.length, filteredCount);

  return (
    <AppShell title="Catalogo X1 WhatsApp">
      <section className="inbox-page">
        <div className="inbox-hero">
          <div>
            <p className="page-subtitle">
              {filteredCount} conversas neste filtro, {withoutMessageCount} sem mensagem salva ainda
            </p>
            <p className="muted">
              Catalogo X1, nao inbox: a lista vem de WhatsappChat, mostra contatos individuais e
              ignora grupos, broadcasts e newsletters.
            </p>
            <p className="muted">
              Conexao: {whatsappSession.status}. Modo rapido ativo: mensagens recebidas nao sao salvas
              como historico pesado. Alguns nomes dependem do que o WhatsApp entrega.
            </p>
          </div>
          <div className="inbox-actions">
            <StartConversationForm />
            <SyncHistoryButton />
          </div>
        </div>

        <div className="inbox-metrics">
          <article className="metric-card">
            <span>Contatos individuais</span>
            <strong>{totalX1Chats}</strong>
          </article>
          <article className="metric-card">
            <span>Com mensagem</span>
            <strong>{withMessageCount}</strong>
          </article>
          <article className="metric-card">
            <span>Sem mensagem</span>
            <strong>{withoutMessageCount}</strong>
          </article>
          <article className="metric-card">
            <span>Etiquetados</span>
            <strong>{labeledCount}</strong>
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
            {type !== DEFAULT_FILTER ? <input name="type" type="hidden" value={type} /> : null}
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

        {type !== "without-message" && withoutMessageCount > 0 ? (
          <div className="empty-hint">
            Modo X1 ativo: grupos antigos no banco ficam fora da inbox e nao sao elegiveis para envio.
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
              const hasMessageSummary = Boolean(chat.lastMessageText || chat.lastMessageAt);
              const date = formatDate(chat.lastMessageAt ?? chat.updatedAt);
              const lastDirection = getLastDirection(chat);
              const activeLabels = chat.labels.filter((item) => !item.label.deleted);
              const isLid = chat.jid.endsWith("@lid");

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
                      {isLid ? <span className="badge warning">@lid</span> : null}
                      {activeLabels.length > 0 ? (
                        <span className="label-badge">
                          {activeLabels.length} etiqueta{activeLabels.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {!hasMessageSummary ? <span className="badge warning">sem mensagem</span> : null}
                      {lastDirection ? <span>{lastDirection}</span> : null}
                      {chat.unreadCount > 0 ? <span>{chat.unreadCount} nao lidas</span> : null}
                    </span>
                    {chat.lastMessageText ? (
                      <span className="conversation-preview">{chat.lastMessageText}</span>
                    ) : (
                      <span className="conversation-preview empty">
                        Contato no catalogo X1
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
