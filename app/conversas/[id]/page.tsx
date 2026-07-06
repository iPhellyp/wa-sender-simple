import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import { SendMessageForm } from "./SendMessageForm";

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

function getTitle(chat: {
  jid: string;
  name: string | null;
}) {
  if (chat.name) {
    return chat.name;
  }

  return chat.jid.endsWith("@s.whatsapp.net") ? chat.jid.split("@")[0] : chat.jid;
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
  const title = getTitle(chat);

  return (
    <AppShell
      title="Conversa"
      actions={
        <div className="button-row">
          <Link className="button secondary" href="/conversas">
            Voltar
          </Link>
          <Link className="button secondary" href={`/conversas/${chat.id}`}>
            Atualizar
          </Link>
        </div>
      }
    >
      <section className="chat-page">
        <header className="chat-header">
          <div className={`conversation-avatar large ${chat.isGroup ? "group" : ""}`}>
            {chat.isGroup ? "G" : title.replace(/\W/g, "").slice(0, 1).toUpperCase() || "#"}
          </div>
          <div className="chat-header-main">
            <div className="chat-title-row">
              <h2>{title}</h2>
              <span className={`badge ${chat.isGroup ? "info" : "success"}`}>
                {chat.isGroup ? "grupo" : "contato"}
              </span>
            </div>
            <div className="chat-subtitle">{chat.jid}</div>
            <div className="chat-meta-row">
              <span>Ultima mensagem: {formatDate(chat.lastMessageAt)}</span>
              <span>{messages.length} exibidas</span>
              <span>{chat.unreadCount} nao lidas</span>
            </div>
          </div>
        </header>

        <div className="chat-thread">
          {messages.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhuma mensagem salva para esta conversa.</strong>
              <span>Envie uma mensagem manual ou aguarde novos eventos do WhatsApp.</span>
            </div>
          ) : (
            messages.map((message) => (
              <article
                className={`chat-message-row ${message.fromMe ? "outbound" : "inbound"}`}
                key={message.id}
              >
                <div className="chat-bubble">
                  {chat.isGroup && !message.fromMe && message.senderJid ? (
                    <div className="chat-sender">{message.senderJid}</div>
                  ) : null}
                  <div className="chat-message-text">{messageText(message)}</div>
                  <div className="chat-message-time">
                    {message.fromMe ? "Eu" : "Contato"} | {formatDate(message.timestamp)}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <footer className="chat-composer">
          <SendMessageForm chatId={chat.id} isGroup={chat.isGroup} />
        </footer>
      </section>
    </AppShell>
  );
}
