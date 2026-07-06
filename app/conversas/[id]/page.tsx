import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";
import { SendMessageForm } from "./SendMessageForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

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

function formatDate(value: Date | null) {
  return value ? dateFormatter.format(value) : "-";
}

function messageText(message: {
  text: string | null;
  messageType: string | null;
}) {
  return message.text ?? (message.messageType ? `[${message.messageType}]` : "Sem texto");
}

function getContactDisplayName(jid: string | null, contactByJid: Map<string, ContactSummary>) {
  if (!jid) {
    return null;
  }

  const contact = contactByJid.get(jid);

  return getWhatsappDisplayName({
    jid,
    contactName: contact?.name,
    contactPushName: contact?.pushName
  });
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
  const contactJids = Array.from(
    new Set([chat.jid, ...messages.map((message) => message.senderJid).filter((jid): jid is string => Boolean(jid))])
  );
  const contacts = contactJids.length > 0
    ? await prisma.whatsappContact.findMany({
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
      })
    : [];
  const contactByJid = new Map<string, ContactSummary>(
    contacts.map((contact) => [contact.jid, contact])
  );
  const chatContact = contactByJid.get(chat.jid);
  const title = getWhatsappDisplayName({
    jid: chat.jid,
    chatName: chat.name,
    contactName: chatContact?.name,
    contactPushName: chatContact?.pushName,
    isGroup: chat.isGroup
  });

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
            <div className="chat-subtitle">{getWhatsappIdentityLabel(chat.jid)}</div>
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
                    <div className="chat-sender">
                      {getContactDisplayName(message.senderJid, contactByJid)}
                    </div>
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
