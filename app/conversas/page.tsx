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
  }>;
};

type ConversationFilter = "recent" | "all" | "contacts" | "groups" | "empty";

const chatListInclude = {
  _count: {
    select: {
      messages: true
    }
  }
} satisfies Prisma.WhatsappChatInclude;

type ChatListItem = Prisma.WhatsappChatGetPayload<{
  include: typeof chatListInclude;
}>;

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

function buildFilterHref(type: ConversationFilter, query: string) {
  const params = new URLSearchParams();

  if (type !== "recent") {
    params.set("type", type);
  }

  if (query) {
    params.set("q", query);
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

function sortConversations(a: ChatListItem, b: ChatListItem) {
  const aHasMessage = a._count.messages > 0 || Boolean(a.lastMessageAt);
  const bHasMessage = b._count.messages > 0 || Boolean(b.lastMessageAt);

  if (aHasMessage !== bHasMessage) {
    return aHasMessage ? -1 : 1;
  }

  if (aHasMessage && bHasMessage) {
    const lastA = a.lastMessageAt?.getTime() ?? a.updatedAt.getTime();
    const lastB = b.lastMessageAt?.getTime() ?? b.updatedAt.getTime();

    return lastB - lastA;
  }

  if (a.isGroup !== b.isGroup) {
    return a.isGroup ? -1 : 1;
  }

  return b.updatedAt.getTime() - a.updatedAt.getTime();
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
  const matchedContactJids = await findMatchingContactJids(query);
  const where = andWhere(getScopeWhere(type), getSearchWhere(query, matchedContactJids));

  const [
    chats,
    totalChats,
    withMessagesCount,
    individualCount,
    groupCount,
    emptyCount
  ] = await Promise.all([
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
      take: type === "empty" ? 120 : 150,
      include: chatListInclude
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

  const sortedChats = [...chats].sort(sortConversations);
  const chatJids = sortedChats.map((chat) => chat.jid);
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
              o historico para sessao ja pareada. Se o historico antigo nao vier, pode ser necessario
              resetar/reconectar manualmente.
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
                href={buildFilterHref(filter, query)}
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

        {sortedChats.length === 0 ? (
          <div className="empty-state">
            <strong>Nenhuma conversa encontrada.</strong>
            <span>Altere o filtro, sincronize o historico ou inicie uma conversa por telefone.</span>
          </div>
        ) : (
          <div className="conversation-grid">
            {sortedChats.map((chat) => {
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
      </section>
    </AppShell>
  );
}
