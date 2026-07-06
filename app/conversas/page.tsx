import Link from "next/link";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationsPageProps = {
  searchParams?: Promise<{
    q?: string | string[];
  }>;
};

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

export default async function ConversationsPage({ searchParams }: ConversationsPageProps) {
  const query = getSearchValue(await searchParams);

  const chats = await prisma.whatsappChat.findMany({
    where: query
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
      : undefined,
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
  });

  return (
    <AppShell title="Conversas">
      <section className="grid">
        <div className="card">
          <form action="/conversas" className="button-row" method="get">
            <input
              className="input"
              defaultValue={query}
              name="q"
              placeholder="Buscar por nome, JID ou ultima mensagem"
              type="search"
            />
            <button className="button" type="submit">
              Buscar
            </button>
            {query ? (
              <Link className="button secondary" href="/conversas">
                Limpar
              </Link>
            ) : null}
          </form>
        </div>

        <div className="card">
          {chats.length === 0 ? (
            <div className="muted">Nenhuma conversa sincronizada ainda.</div>
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
                    <th>Mensagens</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {chats.map((chat) => (
                    <tr key={chat.id}>
                      <td>
                        <strong>{chat.name ?? chat.jid}</strong>
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
      </section>
    </AppShell>
  );
}
