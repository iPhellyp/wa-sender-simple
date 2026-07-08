"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isIndividualWhatsappIdentifier } from "@/src/lib/whatsapp/individual-chat-filter";

export type CatalogConversationItem = {
  id: string;
  href: string;
  displayName: string;
  identityLabel: string;
  avatarText: string;
  jid: string;
  isLid: boolean;
  labels: string[];
  preview: string;
  hasMessage: boolean;
  lastDirection: string | null;
  unreadCount: number;
  sortDateLabel: string;
  sortSource: "message" | "update";
  sendStatus: "sent" | "failed" | "pending" | "never_sent";
  sendStatusLabel: string;
  sentAtLabel: string | null;
  campaignName: string | null;
  error: string | null;
};

const MAX_QUERY_CHAT_IDS = 80;

function sendStatusClass(status: CatalogConversationItem["sendStatus"]) {
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

export function CatalogSelectionClient({ items }: { items: CatalogConversationItem[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const visibleItems = useMemo(
    () => items.filter((item) => isIndividualWhatsappIdentifier(item.jid)),
    [items]
  );
  const selected = useMemo(
    () => visibleItems.filter((item) => selectedIds.has(item.id)),
    [visibleItems, selectedIds]
  );
  const hasSelection = selected.length > 0;
  const exceedsQueryLimit = selected.length > MAX_QUERY_CHAT_IDS;
  const activeInstanceId = useMemo(() => {
    const href = visibleItems[0]?.href ?? "";
    const query = href.split("?")[1] ?? "";
    return new URLSearchParams(query).get("instanceId") ?? "";
  }, [visibleItems]);
  const campaignHref =
    hasSelection && !exceedsQueryLimit
      ? `/campanhas?chatIds=${selected.map((item) => item.id).join(",")}${
          activeInstanceId ? `&instanceId=${activeInstanceId}` : ""
        }`
      : activeInstanceId
        ? `/campanhas?instanceId=${activeInstanceId}`
        : "/campanhas";

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <div className="catalog-selection">
      <div className="catalog-selection-bar compact">
        <div className="button-row">
          <button
            className="button secondary"
            disabled={visibleItems.length === 0}
            type="button"
            onClick={() => setSelectedIds(new Set(visibleItems.map((item) => item.id)))}
          >
            Selecionar visiveis
          </button>
          <button
            className="button secondary"
            disabled={!hasSelection}
            type="button"
            onClick={() => setSelectedIds(new Set())}
          >
            Limpar selecao
          </button>
        </div>
        <div className="button-row">
          <span className="muted">{selected.length} selecionado(s)</span>
          <Link
            className={`button ${hasSelection && !exceedsQueryLimit ? "" : "secondary"}`}
            href={campaignHref}
            aria-disabled={!hasSelection || exceedsQueryLimit}
          >
            Criar campanha com selecionados
          </Link>
        </div>
      </div>

      {exceedsQueryLimit ? (
        <div className="message error">
          Selecione ate {MAX_QUERY_CHAT_IDS} contatos para enviar por query string com seguranca.
        </div>
      ) : null}

      <div className="conversation-grid compact">
        {visibleItems.map((item) => (
          <article className="inbox-conversation-card catalog-card compact-conversation-card" key={item.id}>
            <label className="catalog-checkbox" title="Selecionar contato">
              <input
                checked={selectedIds.has(item.id)}
                type="checkbox"
                onChange={() => toggle(item.id)}
              />
            </label>
            <Link className="conversation-avatar" href={item.href}>
              {item.avatarText}
            </Link>
            <span className="conversation-card-body compact">
              <span className="conversation-card-top">
                <span className="conversation-title-block">
                  <strong>{item.displayName}</strong>
                  <span>{item.identityLabel}</span>
                </span>
                <span className="conversation-time">{item.sortDateLabel}</span>
              </span>
              <span className="conversation-card-meta">
                <span className={`badge ${item.hasMessage ? "success" : "warning"}`}>
                  {item.hasMessage ? "com mensagem" : "sem mensagem"}
                </span>
                <span className={`badge ${sendStatusClass(item.sendStatus)}`}>
                  {item.sendStatusLabel}
                </span>
                {item.isLid ? <span className="badge warning">@lid</span> : null}
                <span className="future-tag compact">
                  ordenado por {item.sortSource === "message" ? "mensagem" : "atualizacao"}
                </span>
                {item.lastDirection ? <span>{item.lastDirection}</span> : null}
                {item.unreadCount > 0 ? <span>{item.unreadCount} nao lidas</span> : null}
              </span>
              <span className={item.preview ? "conversation-preview" : "conversation-preview empty"}>
                {item.preview || "Contato nas conversas"}
              </span>
              <span className="conversation-card-footer">
                {item.labels.length > 0 ? (
                  <span className="label-badges">
                    {item.labels.slice(0, 4).map((label) => (
                      <span className="label-badge" key={label}>
                        {label}
                      </span>
                    ))}
                    {item.labels.length > 4 ? (
                      <span className="label-badge">+{item.labels.length - 4}</span>
                    ) : null}
                  </span>
                ) : (
                  <span className="future-tag compact">sem etiqueta</span>
                )}
                {item.sentAtLabel ? <span>enviado em {item.sentAtLabel}</span> : null}
                {item.campaignName ? <span>{item.campaignName}</span> : null}
                {item.error ? <span className="send-error">{item.error}</span> : null}
                <Link
                  className="button secondary compact-button"
                  href={`/campanhas?chatIds=${item.id}${activeInstanceId ? `&instanceId=${activeInstanceId}` : ""}`}
                >
                  Campanha
                </Link>
              </span>
            </span>
          </article>
        ))}
      </div>
    </div>
  );
}

