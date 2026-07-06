import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import { StartConversationForm } from "./StartConversationForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationsPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
    type?: string | string[];
  }>;
};

type ConversationFilter = "all" | "contacts" | "groups";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

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

  if (type === "contacts" || type === "groups") {
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

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const resolvedSearchParams = await searchParams;
  const query = getSearchValue(resolvedSearchParams);
  const type = getFilterValue(resolvedSearchParams);
  const where = {
    ...(type === "contacts" ? { isGroup: false } : {}),
    ...(type === "groups" ? { isGroup: true } : {}),
    ...(query
      ? {
          OR: [
            {
              name: {
                contains: query,
                mode: "insensitive" as const
              }
            },
            {
              jid: {
                contains: query,
                mode: "insensitive" as const
              }
            },
            {
              lastMessageText: {
                contains: query,
                mode: "insensitive" as const
              }
            }
          ]
        }
      : {})
  };

  const [chats, individualCount, groupCount] = await Promise.all([
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

  return (
    <AppShell title="Conversas">
      <section className="grid two-column">
        <div className="grid">
          <div className="card">
            <div className="button-row" style={{ marginBottom: 12 }}>
              <Link className={`button secondary ${type === "all" ? "active" : ""}`} href={buildFilterHref("all", query)}>
                Todas
              </Link>
              <Link
                className={`button secondary ${type === "contacts" ? "active" : ""}`}
                href={buildFilterHref("contacts", query)}
              >
                Contatos
              </Link>
              <Link
                className={`button secondary ${type === "groups" ? "active" : ""}`}
                href={buildFilterHref("groups", query)}
              >
                Grupos
              </Link>
            </div>

            <form action="/conversas" className="button-row" method="get">
              {type !== "all" ? <input name="type" type="hidden" value={type} /> : null}
              <input
                className="input"
                defaultValue={query}
                name="q"
                placeholder="Buscar por nome, JID, telefone ou ultima mensagem"
                type="search"
              />
              <button className="button" type="submit">
                Buscar
              </button>
              {query ? (
                <Link className="button secondary" href={buildFilterHref(type, "")}>
                  Limpar
                </Link>
              ) : null}
            </form>
          </div>

          {individualCount === 0 && groupCount > 0 ? (
            <div className="message">
              Ainda nao ha conversas individuais sincronizadas. Voce pode iniciar uma nova conversa por telefone.
            </div>
          ) : null}

          <div className="card">
            {chats.length === 0 ? (
              <div className="muted">Nenhuma conversa encontrada.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Conversa</th>
                      <th>Tipo</th>
                      <th>Ultima mensagem</th>
                      <th>Direcao</th>
                      <th>Data</th>
                      <th>Nao lidas</th>
                      <th>Mensagens</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chats.map((chat) => (
                      <tr key={chat.id}>
                        <td>
                          <strong>{chat.name ?? getPhoneFromJid(chat.jid)}</strong>
                          <br />
                          <span className="muted">{chat.jid}</span>
                        </td>
                        <td>
                          <span className={`badge ${chat.isGroup ? "info" : "success"}`}>
                            {chat.isGroup ? "grupo" : "contato"}
                          </span>
                        </td>
                        <td>{chat.lastMessageText ?? "-"}</td>
                        <td>{getLastDirection(chat)}</td>
                        <td>{formatDate(chat.lastMessageAt)}</td>
                        <td>{chat.unreadCount}</td>
                        <td>{chat._count.messages}</td>
                        <td>
                          <Link className="button secondary" href={`/conversas/${chat.id}`}>
                            Abrir
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Nova conversa</h2>
          <StartConversationForm />
        </div>
      </section>
    </AppShell>
  );
}
