import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { prisma } from "@/src/lib/prisma/client";
import {
  getWhatsappDisplayName,
  getWhatsappIdentityLabel
} from "@/src/lib/whatsapp/display-name";
import { getWhatsappStatusPayload } from "@/src/lib/baileys/client";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  getActiveInstanceIdFromSearchOrDefault
} from "@/src/lib/server/whatsapp-instances";
import { ConversationMessagesClient } from "./ConversationMessagesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    instanceId?: string;
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

export default async function ConversationDetailPage({ params, searchParams }: ConversationDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(
    new URLSearchParams(resolvedSearchParams?.instanceId ? { instanceId: resolvedSearchParams.instanceId } : {})
  );
  const [chat, whatsappSession, whatsappInstance] = await Promise.all([
    prisma.whatsappChat.findFirst({
      where: {
        id,
        instanceId
      },
      include: {
        labels: {
          include: {
            label: {
              select: {
                id: true,
                instanceId: true,
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
    getWhatsappStatusPayload(),
    prisma.whatsappInstance.findUnique({
      where: {
        id: instanceId
      }
    })
  ]);

  if (!chat) {
    notFound();
  }

  const chatContact = await prisma.whatsappContact.findFirst({
    where: {
      instanceId: chat.instanceId,
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
  const whatsappStatus =
    instanceId === DEFAULT_WHATSAPP_INSTANCE_ID
      ? whatsappSession.status
      : whatsappInstance?.status ?? "disconnected";

  return (
    <AppShell
      title="Conversa"
      actions={
        <div className="button-row">
          <Link className="button secondary" href={`/conversas?instanceId=${instanceId}`}>
            Voltar
          </Link>
          {chat.isGroup ? (
            <Link className="button secondary" href={`/conversas?instanceId=${instanceId}`}>
              Voltar para contatos
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
                    <Link
                      className="label-badge"
                      href={`/etiquetas/${item.label.id}?instanceId=${instanceId}`}
                      key={item.id}
                    >
                      {item.label.name}
                    </Link>
                  ))}
              </div>
            ) : null}
            <div className="chat-meta-row">
              <span>Ultima mensagem: {formatDate(chat.lastMessageAt)}</span>
              <span>{chat._count.messages} salvas</span>
              <span>{chat.unreadCount} nao lidas</span>
              <span>Conexao: {whatsappStatus}</span>
            </div>
          </div>
        </header>

        {chat.isGroup ? (
          <div className="empty-state">
            <strong>Grupo ignorado.</strong>
            <span>Nenhum envio sera permitido para esta conversa.</span>
          </div>
        ) : (
          <Suspense fallback={<div className="data-card empty-state compact">Carregando mensagens...</div>}>
        <ConversationMessagesClient
            chatId={chat.id}
            isGroup={chat.isGroup}
            totalMessages={chat._count.messages}
            whatsappStatus={whatsappStatus}
            instanceId={instanceId}
          />
      </Suspense>
        )}
      </section>
    </AppShell>
  );
}



