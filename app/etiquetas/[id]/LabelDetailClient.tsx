"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LabelDetailResponse = {
  label: {
    id: string;
    name: string;
    color: string | null;
    waLabelId: string;
    updatedAt: string;
  };
  metrics: {
    conversationCount: number;
    contactCount: number;
    groupCount: number;
  };
  conversations: Array<{
    chatId: string;
    jid: string;
    name: string;
    isGroup: boolean;
    lastMessageAt: string | null;
    lastMessageText: string | null;
  }>;
  error?: string;
};

export function LabelDetailClient({ labelId }: { labelId: string }) {
  const [type, setType] = useState<"all" | "contacts" | "groups">("all");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<LabelDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("type", type);
        if (search.trim()) {
          params.set("search", search.trim());
        }

        const response = await fetch(`/api/etiquetas/${labelId}?${params.toString()}`, {
          cache: "no-store"
        });
        const payload = (await response.json()) as LabelDetailResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar etiqueta");
        }

        setData(payload);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [labelId, type, search]);

  const conversations = useMemo(() => data?.conversations ?? [], [data]);

  if (loading && !data) {
    return <div className="card">Carregando etiqueta...</div>;
  }

  if (error && !data) {
    return <div className="message error">{error}</div>;
  }

  return (
    <section className="grid">
      <div className="button-row">
        <Link className="button secondary" href="/etiquetas">
          Voltar
        </Link>
        <Link className="button" href={`/etiquetas/${labelId}/enviar`}>
          Criar envio para esta etiqueta
        </Link>
      </div>

      <div className="card">
        <h2>{data?.label.name}</h2>
        <p className="muted">ID WhatsApp: {data?.label.waLabelId}</p>
        <div className="inbox-metrics">
          <article className="metric-card">
            <span>Conversas</span>
            <strong>{data?.metrics.conversationCount ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Contatos</span>
            <strong>{data?.metrics.contactCount ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Grupos</span>
            <strong>{data?.metrics.groupCount ?? 0}</strong>
          </article>
        </div>
      </div>

      <div className="inbox-toolbar">
        <nav className="segmented" aria-label="Filtro da etiqueta">
          {(["all", "contacts", "groups"] as const).map((filter) => (
            <button
              className={type === filter ? "active" : ""}
              key={filter}
              type="button"
              onClick={() => setType(filter)}
            >
              {filter === "all" ? "Todas" : filter === "contacts" ? "Contatos" : "Grupos"}
            </button>
          ))}
        </nav>
        <input
          className="input"
          placeholder="Buscar conversa"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {conversations.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhuma conversa nesta etiqueta.</strong>
        </div>
      ) : (
        <div className="conversation-grid">
          {conversations.map((conversation) => (
            <Link
              className="inbox-conversation-card"
              href={`/conversas/${conversation.chatId}`}
              key={conversation.chatId}
            >
              <span className="conversation-card-body">
                <strong>{conversation.name}</strong>
                <span className="conversation-card-meta">
                  <span className={`badge ${conversation.isGroup ? "info" : "success"}`}>
                    {conversation.isGroup ? "grupo" : "contato"}
                  </span>
                </span>
                <span className="conversation-preview">
                  {conversation.lastMessageText ?? "Sem mensagem salva"}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
