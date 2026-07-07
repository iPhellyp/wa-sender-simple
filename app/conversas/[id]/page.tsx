import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import { ConversationMessagesClient } from "./ConversationMessagesClient";

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

export default async function ConversationDetailPage({ params }: ConversationDetailPageProps) {
  const { id } = await params;
  const [chat, whatsappSession] = await Promise.all([
    prisma.whatsappChat.findUnique({
      where: {
        id
      },
      include: {
        labels: {
          include: {
            label: {
              select: {
                id: true,
                name: true,
                deleted: true
              }
            }
          }
        },
        _count: {
          select: {
            messages: true
          }
        }
      }
    }),
    getWhatsappStatusPayload()
  ]);

  if (!chat) {
    notFound();
  }

  const chatContact = await prisma.whatsappContact.findUnique({
    where: {
      jid: chat.jid
    },
    select: {
      name: true,
      pushName: true
    }
  });
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
          {chat.isGroup ? (
            <Link className="button secondary" href="/conversas">
              Voltar para X1
            </Link>
          ) : null}
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
            {chat.isGroup ? (
              <div className="inline-note">
                Esta conversa e um grupo antigo. Grupos nao recebem envios e ficam fora
                da inbox principal.
              </div>
            ) : null}
            {chat.labels.filter((item) => !item.label.deleted).length > 0 ? (
              <div className="label-badges">
                {chat.labels
                  .filter((item) => !item.label.deleted)
                  .map((item) => (
                    <Link className="label-badge" href={`/etiquetas/${item.label.id}`} key={item.id}>
                      {item.label.name}
                    </Link>
                  ))}
              </div>
            ) : null}
            <div className="chat-meta-row">
              <span>Ultima mensagem: {formatDate(chat.lastMessageAt)}</span>
              <span>{chat._count.messages} salvas</span>
              <span>{chat.unreadCount} nao lidas</span>
              <span>Conexao: {whatsappSession.status}</span>
            </div>
          </div>
        </header>

        {chat.isGroup ? (
          <div className="empty-state">
            <strong>Grupo ignorado.</strong>
            <span>Nenhum envio sera permitido para esta conversa.</span>
          </div>
        ) : (
          <ConversationMessagesClient
            chatId={chat.id}
            isGroup={chat.isGroup}
            totalMessages={chat._count.messages}
            whatsappStatus={whatsappSession.status}
          />
        )}
      </section>
    </AppShell>
  );
}
