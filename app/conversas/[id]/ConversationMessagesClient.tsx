"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SendMessageForm } from "./SendMessageForm";

type ConversationMessage = {
  id: string;
  fromMe: boolean;
  senderJid: string | null;
  senderName: string | null;
  messageType: string | null;
  text: string;
  timestamp: string | null;
  createdAt: string;
};

type MessagesResponse = {
  hasMore: boolean;
  messages: ConversationMessage[];
  error?: string;
};

type ConversationMessagesClientProps = {
  chatId: string;
  isGroup: boolean;
  whatsappStatus: string;
  instanceId?: string;
  totalMessages: number;
};

const PAGE_SIZE = 80;
const POLL_INTERVAL_MS = 8000;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeZone: "America/Sao_Paulo"
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

function messageDate(message: ConversationMessage) {
  return new Date(message.timestamp ?? message.createdAt);
}

function formatDay(message: ConversationMessage) {
  return dateFormatter.format(messageDate(message));
}

function formatTime(message: ConversationMessage) {
  return timeFormatter.format(messageDate(message));
}

function mergeUniqueMessages(messages: ConversationMessage[]) {
  const byId = new Map<string, ConversationMessage>();

  for (const message of messages) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(
    (a, b) => messageDate(a).getTime() - messageDate(b).getTime()
  );
}

export function ConversationMessagesClient({
  chatId,
  isGroup,
  whatsappStatus,
  totalMessages
}: ConversationMessagesClientProps) {
  const searchParams = useSearchParams();
  const activeInstanceId = searchParams.get("instanceId") ?? "";
  const threadRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      const thread = threadRef.current;

      if (thread) {
        thread.scrollTop = thread.scrollHeight;
      }
    });
  }, []);

  const isNearBottom = useCallback(() => {
    const thread = threadRef.current;

    if (!thread) {
      return true;
    }

    return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140;
  }, []);

  const loadLatest = useCallback(
    async (options: { keepPosition?: boolean } = {}) => {
      const shouldScroll = !options.keepPosition || isNearBottom();

      setRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE)
        });
        if (activeInstanceId) params.set("instanceId", activeInstanceId);
        const response = await fetch(`/api/conversas/${chatId}/messages?${params.toString()}`, {
          cache: "no-store"
        });
        const data = (await response.json()) as MessagesResponse;

        if (!response.ok) {
          throw new Error(data.error ?? "Erro ao carregar mensagens");
        }

        setMessages((current) =>
          options.keepPosition ? mergeUniqueMessages([...current, ...data.messages]) : data.messages
        );
        setHasMore((current) => (options.keepPosition ? current || data.hasMore : data.hasMore));

        if (shouldScroll) {
          scrollToBottom();
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeInstanceId, chatId, isNearBottom, scrollToBottom]
  );

  const loadOlder = useCallback(async () => {
    const oldestMessage = messages[0];

    if (!oldestMessage || loadingOlder) {
      return;
    }

    const thread = threadRef.current;
    const previousScrollHeight = thread?.scrollHeight ?? 0;

    setLoadingOlder(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        before: oldestMessage.id
      });
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`/api/conversas/${chatId}/messages?${params.toString()}`, {
        cache: "no-store"
      });
      const data = (await response.json()) as MessagesResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao carregar mensagens anteriores");
      }

      setMessages((current) => mergeUniqueMessages([...data.messages, ...current]));
      setHasMore(data.hasMore);

      window.requestAnimationFrame(() => {
        const updatedThread = threadRef.current;

        if (updatedThread) {
          updatedThread.scrollTop = updatedThread.scrollHeight - previousScrollHeight;
        }
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
    } finally {
      setLoadingOlder(false);
    }
  }, [activeInstanceId, chatId, loadingOlder, messages]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    if (whatsappStatus !== "connected") {
      return undefined;
    }

    const interval = window.setInterval(() => {
      void loadLatest({ keepPosition: true });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loadLatest, whatsappStatus]);

  let lastDay: string | null = null;

  return (
    <>
      <div className="chat-sync-bar">
        <span>
          Status: {whatsappStatus}. {messages.length} visiveis de {totalMessages} salvas.
        </span>
        <span>Atualizacao automatica por polling a cada 8s.</span>
        <button
          className="button secondary"
          disabled={refreshing}
          type="button"
          onClick={() => void loadLatest()}
        >
          {refreshing ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {error ? <div className="message error">{error}</div> : null}

      <div className="chat-thread" ref={threadRef}>
        {hasMore ? (
          <div className="chat-load-older">
            <button
              className="button secondary"
              disabled={loadingOlder}
              type="button"
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? "Carregando..." : "Carregar anteriores"}
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="empty-state">Carregando mensagens...</div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <strong>Conversa encontrada no WhatsApp, mas sem mensagens salvas ainda.</strong>
            <span>Eventos tecnicos do WhatsApp ficam ocultos por padrao.</span>
          </div>
        ) : (
          messages.map((message) => {
            const currentDay = formatDay(message);
            const showDay = currentDay !== lastDay;
            lastDay = currentDay;

            return (
              <div key={message.id}>
                {showDay ? <div className="chat-date-separator">{currentDay}</div> : null}
                <article className={`chat-message-row ${message.fromMe ? "outbound" : "inbound"}`}>
                  <div className="chat-bubble">
                    {isGroup && !message.fromMe && message.senderName ? (
                      <div className="chat-sender">{message.senderName}</div>
                    ) : null}
                    <div className="chat-message-text">{message.text}</div>
                    <div className="chat-message-time">
                      {message.fromMe ? "Eu" : "Contato"} | {formatTime(message)}
                    </div>
                  </div>
                </article>
              </div>
            );
          })
        )}
      </div>

      <footer className="chat-composer">
        <SendMessageForm
          chatId={chatId}
          instanceId={activeInstanceId}
          isGroup={isGroup}
          onSent={() => {
            window.setTimeout(() => void loadLatest(), 1200);
          }}
        />
      </footer>
    </>
  );
}


