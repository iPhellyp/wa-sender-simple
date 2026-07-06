import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
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

type ConversationFilter = "all" | "contacts" | "groups" | "unread";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const filterLabels: Record<ConversationFilter, string> = {
  all: "Todas",
  contacts: "Contatos",
  groups: "Grupos",
  unread: "Nao lidas"
};

function formatDate(value: Date | null) {
  return value ? dateFormatter.format(value) : "-";
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

  return "-";
}

function getSearchValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawQuery = searchParams?.q;
  const query = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery;

  return query?.trim() ?? "";
}

function getFilterValue(searchParams: Awaited<ConversationsPageProps["searchParams"]>) {
  const rawType = searchParams?.type;
  const type = Array.isArray(rawType) ? rawType[0] : rawType;

  if (type === "contacts" || type === "groups" || type === "unread") {
    return type;
  }

  return "all";
}

function buildFilterHref(type: ConversationFilter, query: string) {
  const params = new URLSearchParams();

  if (type !== "all") {
    params.set("type", type);
  }

  if (query) {
    params.set("q", query);
  }

  const suffix = params.toString();
  return suffix ? `/conversas?${suffix}` : "/conversas";
}

function getPhoneFromJid(jid: string) {
  return jid.endsWith("@s.whatsapp.net") ? jid.split("@")[0] : jid;
}

function getConversationName(chat: {
  jid: string;
  name: string | null;
}) {
  return chat.name ?? getPhoneFromJid(chat.jid);
}

function getAvatarText(name: string, isGroup: boolean) {
  if (isGroup) {
    return "G";
  }

  return name.replace(/\W/g, "").slice(0, 1).toUpperCase() || "#";
}

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = getSearchValue(resolvedSearchParams);
  const type = getFilterValue(resolvedSearchParams);
  const where: Prisma.WhatsappChatWhereInput = {
    ...(type === "contacts" ? { isGroup: false } : {}),
    ...(type === "groups" ? { isGroup: true } : {}),
    ...(type === "unread" ? { unreadCount: { gt: 0 } } : {}),
    ...(query
      ? {
          OR: [
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
          ]
        }
      : {})
  };

  const [chats, totalChats, individualCount, groupCount, unreadCount, messageCount] =
    await Promise.all([
      prisma.whatsappChat.findMany({
        where,
        orderBy: [
          {
            lastMessageAt: "desc"
          },
          {
            updatedAt: "desc"
          }
        ],
        take: 100,
        include: {
          _count: {
            select: {
              messages: true
            }
          }
        }
      }),
      prisma.whatsappChat.count(),
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
          unreadCount: {
            gt: 0
          }
        }
      }),
      prisma.whatsappMessage.count()
    ]);

  return (
    <AppShell title="Inbox WhatsApp">
      <section className="inbox-page">
        <div className="inbox-hero">
          <div>
            <p className="page-subtitle">
              {totalChats} conversas sincronizadas, {messageCount} mensagens salvas
            </p>
            <p className="muted">
              Use a sincronizacao para escutar eventos de historico. Se a sessao antiga nao reenviar tudo,
              pode ser necessario reconectar manualmente.
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
            <span>Contatos individuais</span>
            <strong>{individualCount}</strong>
          </article>
          <article className="metric-card">
            <span>Grupos</span>
            <strong>{groupCount}</strong>
          </article>
          <article className="metric-card">
            <span>Mensagens salvas</span>
            <strong>{messageCount}</strong>
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
                {filter === "unread" && unreadCount > 0 ? <span>{unreadCount}</span> : null}
              </Link>
            ))}
          </nav>

          <form action="/conversas" className="inbox-search" method="get">
            {type !== "all" ? <input name="type" type="hidden" value={type} /> : null}
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

        {individualCount === 0 && groupCount > 0 ? (
          <div className="empty-hint">
            Ainda nao ha conversas individuais sincronizadas. Tente Sincronizar historico ou inicie uma nova
            conversa por telefone.
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
              const name = getConversationName(chat);

              return (
                <Link className="inbox-conversation-card" href={`/conversas/${chat.id}`} key={chat.id}>
                  <span className={`conversation-avatar ${chat.isGroup ? "group" : ""}`}>
                    {getAvatarText(name, chat.isGroup)}
                  </span>
                  <span className="conversation-card-body">
                    <span className="conversation-card-top">
                      <strong>{name}</strong>
                      <span>{formatDate(chat.lastMessageAt)}</span>
                    </span>
                    <span className="conversation-card-meta">
                      <span className={`badge ${chat.isGroup ? "info" : "success"}`}>
                        {chat.isGroup ? "grupo" : "contato"}
                      </span>
                      <span>{getLastDirection(chat)}</span>
                      <span>{chat._count.messages} mensagens</span>
                      {chat.unreadCount > 0 ? <span>{chat.unreadCount} nao lidas</span> : null}
                    </span>
                    <span className="conversation-preview">{chat.lastMessageText ?? "Sem mensagem salva"}</span>
                    <span className="conversation-card-footer">
                      <span>{chat.jid}</span>
                      <span className="future-tag">Etiquetas em breve</span>
                    </span>
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
