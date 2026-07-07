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
    sentCount: number;
    failedCount: number;
    pendingCount: number;
    neverSentCount: number;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  conversations: Array<{
    chatId: string;
    jid: string;
    name: string;
    isGroup: boolean;
    lastMessageAt: string | null;
    updatedAt: string;
    lastMessageText: string | null;
    sendStatus: "sent" | "failed" | "pending" | "never_sent";
    sentAt: string | null;
    campaignName: string | null;
    error: string | null;
  }>;
  error?: string;
};

const MAX_QUERY_CHAT_IDS = 80;

function sendStatusLabel(status: string) {
  if (status === "sent") {
    return "ja enviado";
  }

  if (status === "failed") {
    return "falhou";
  }

  if (status === "pending") {
    return "pendente";
  }

  return "nunca enviado";
}

function sendStatusClass(status: string) {
  if (status === "sent") {
    return "success";
  }

  if (status === "failed") {
    return "danger";
  }

  if (status === "pending") {
    return "warning";
  }

  return "neutral";
}

export function LabelDetailClient({ labelId }: { labelId: string }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LabelDetailResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", "50");
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
  }, [labelId, page, search]);

  const conversations = useMemo(() => data?.conversations ?? [], [data]);
  const selected = conversations.filter((conversation) => selectedIds.has(conversation.chatId));
  const exceedsQueryLimit = selected.length > MAX_QUERY_CHAT_IDS;
  const selectedCampaignHref =
    selected.length > 0 && !exceedsQueryLimit
      ? `/campanhas?chatIds=${selected.map((item) => item.chatId).join(",")}`
      : "/campanhas";

  function toggle(chatId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }

      return next;
    });
  }

  if (loading && !data) {
    return <div className="card">Carregando segmento...</div>;
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
        <Link className="button" href={`/campanhas?labelId=${labelId}`}>
          Criar campanha com a etiqueta
        </Link>
      </div>

      <div className="section-card">
        <div className="section-card-header">
          <div>
            <h2>{data?.label.name}</h2>
            <p>ID WhatsApp: {data?.label.waLabelId}</p>
          </div>
          <span className="badge success">segmento WhatsApp</span>
        </div>
        <div className="inbox-metrics">
          <article className="metric-card">
            <span>Contatos individuais</span>
            <strong>{data?.metrics.contactCount ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Grupos ignorados</span>
            <strong>{data?.metrics.groupCount ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Ja enviados</span>
            <strong>{data?.metrics.sentCount ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Nunca enviados</span>
            <strong>{data?.metrics.neverSentCount ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Falhas</span>
            <strong>{data?.metrics.failedCount ?? 0}</strong>
          </article>
        </div>
      </div>

      <div className="inbox-toolbar catalog-toolbar">
        <input
          className="input"
          placeholder="Buscar por nome, JID ou mensagem salva"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
            setSelectedIds(new Set());
          }}
        />
        <div className="button-row">
          <button
            className="button secondary"
            disabled={conversations.length === 0}
            type="button"
            onClick={() => setSelectedIds(new Set(conversations.map((item) => item.chatId)))}
          >
            Selecionar visÃ­veis
          </button>
          <button
            className="button secondary"
            disabled={selected.length === 0}
            type="button"
            onClick={() => setSelectedIds(new Set())}
          >
            Limpar seleÃ§Ã£o
          </button>
          <span className="muted">{selected.length} selecionado(s)</span>
          <Link
            className={`button ${selected.length > 0 && !exceedsQueryLimit ? "" : "secondary"}`}
            href={selectedCampaignHref}
          >
            Criar campanha com selecionados
          </Link>
        </div>
      </div>

      {exceedsQueryLimit ? (
        <div className="message error">
          Selecione atÃ© {MAX_QUERY_CHAT_IDS} contatos para enviar por query string.
        </div>
      ) : null}

      {loading ? <div className="message">Atualizando lista...</div> : null}

      {conversations.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhum contato nesta etiqueta.</strong>
          <span>Altere a busca ou force resync de catalogo/app-state na pagina WhatsApp.</span>
        </div>
      ) : (
        <div className="conversation-grid">
          {conversations.map((conversation) => (
            <article className="inbox-conversation-card label-detail-card" key={conversation.chatId}>
              <label className="catalog-checkbox" title="Selecionar contato">
                <input
                  checked={selectedIds.has(conversation.chatId)}
                  type="checkbox"
                  onChange={() => toggle(conversation.chatId)}
                />
              </label>
              <span className="conversation-card-body">
                <span className="conversation-card-top">
                  <span className="conversation-title-block">
                    <strong>{conversation.name}</strong>
                    <span>{conversation.jid}</span>
                  </span>
                  <span className="conversation-time">
                    {new Date(conversation.lastMessageAt ?? conversation.updatedAt).toLocaleString("pt-BR")}
                  </span>
                </span>
                <span className="conversation-card-meta">
                  <span className="badge success">contato</span>
                  <span className={`badge ${sendStatusClass(conversation.sendStatus)}`}>
                    {sendStatusLabel(conversation.sendStatus)}
                  </span>
                  {conversation.sentAt ? (
                    <span>enviado em {new Date(conversation.sentAt).toLocaleString("pt-BR")}</span>
                  ) : null}
                  {conversation.campaignName ? <span>{conversation.campaignName}</span> : null}
                </span>
                <span className="conversation-preview">
                  {conversation.lastMessageText ?? "Sem mensagem salva"}
                </span>
                <span className="conversation-card-footer">
                  <Link className="button secondary compact-button" href={`/conversas/${conversation.chatId}`}>
                    Abrir contato
                  </Link>
                  <Link className="button secondary compact-button" href={`/campanhas?chatIds=${conversation.chatId}`}>
                    Campanha
                  </Link>
                  {conversation.error ? <span className="send-error">{conversation.error}</span> : null}
                </span>
              </span>
            </article>
          ))}
        </div>
      )}

      <div className="button-row" style={{ justifyContent: "space-between" }}>
        <span className="muted">
          Exibindo {data?.pagination.total ? (data.pagination.page - 1) * data.pagination.limit + 1 : 0}-
          {Math.min((data?.pagination.page ?? 1) * (data?.pagination.limit ?? 50), data?.pagination.total ?? 0)} de{" "}
          {data?.pagination.total ?? 0}
        </span>
        <div className="button-row">
          <button
            className="button secondary"
            disabled={(data?.pagination.page ?? 1) <= 1}
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setPage((current) => Math.max(1, current - 1));
            }}
          >
            Anterior
          </button>
          <span className="muted">
            Pagina {data?.pagination.page ?? 1} de {data?.pagination.totalPages ?? 1}
          </span>
          <button
            className="button secondary"
            disabled={(data?.pagination.page ?? 1) >= (data?.pagination.totalPages ?? 1)}
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setPage((current) => current + 1);
            }}
          >
            Proxima
          </button>
        </div>
      </div>
    </section>
  );
}


