import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationDetailPageProps = {
  params: Promise<{
    id: string;
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

function messageText(message: {
  text: string | null;
  messageType: string | null;
}) {
  return message.text ?? (message.messageType ? `[${message.messageType}]` : "Sem texto");
}

export default async function ConversationDetailPage({ params }: ConversationDetailPageProps) {
  const { id } = await params;
  const chat = await prisma.whatsappChat.findUnique({
    where: {
      id
    },
    include: {
      messages: {
        orderBy: [
          {
            timestamp: "desc"
          },
          {
            createdAt: "desc"
          }
        ],
        take: 100
      }
    }
  });

  if (!chat) {
    notFound();
  }

  const messages = [...chat.messages].reverse();

  return (
    <AppShell
      title={chat.name ?? chat.jid}
      actions={
        <Link className="button secondary" href="/conversas">
          Voltar
        </Link>
      }
    >
      <section className="grid">
        <div className="card">
          <div className="conversation-meta">
            <div>
              <div className="muted">JID</div>
              <strong>{chat.jid}</strong>
            </div>
            <div>
              <div className="muted">Tipo</div>
              <span className={`badge ${chat.isGroup ? "info" : "success"}`}>
                {chat.isGroup ? "grupo" : "contato"}
              </span>
            </div>
            <div>
              <div className="muted">Nao lidas</div>
              <strong>{chat.unreadCount}</strong>
            </div>
            <div>
              <div className="muted">Ultima mensagem</div>
              <strong>{formatDate(chat.lastMessageAt)}</strong>
            </div>
          </div>
        </div>

        <div className="card">
          {messages.length === 0 ? (
            <div className="muted">Nenhuma mensagem sincronizada para esta conversa.</div>
          ) : (
            <div className="message-list">
              {messages.map((message) => (
                <article
                  className={`conversation-message ${message.fromMe ? "outbound" : "inbound"}`}
                  key={message.id}
                >
                  <div className="conversation-message-header">
                    <strong>{message.fromMe ? "Eu" : "Contato"}</strong>
                    <span className="muted">{formatDate(message.timestamp)}</span>
                  </div>
                  <div>{messageText(message)}</div>
                  {message.senderJid && message.senderJid !== chat.jid ? (
                    <div className="muted">Origem: {message.senderJid}</div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
