"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type WhatsappSession = {
  id: string;
  status: string;
  qrCode: string | null;
  hasQrCode: boolean;
  connectedPhone: string | null;
  lastError: string | null;
  updatedAt: string;
  latestMessageAt?: string | null;
  message?: string;
  error?: string;
};

function getQrRecoveryMessage(session: WhatsappSession | null) {
  if (
    !session?.lastError ||
    (session.status !== "error" && session.status !== "disconnected") ||
    !/(428|qr)/i.test(session.lastError)
  ) {
    return null;
  }

  return "Nao foi possivel gerar QR. Clique Resetar sessao uma vez e depois Reconectar. Se persistir, o sistema usara modo QR seguro.";
}

function isTransientReconnectStatus(session: WhatsappSession | null) {
  return (
    session?.status === "connecting" &&
    /reconectando apos queda transitoria/i.test(session.lastError ?? "")
  );
}

export function WhatsappClient() {
  const [session, setSession] = useState<WhatsappSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
      const data = (await response.json()) as WhatsappSession;

      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao carregar status do WhatsApp");
      }

      setSession(data);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function postAction(path: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: "POST"
      });

      const data = (await response.json()) as WhatsappSession;
      setSession(data);

      if (!response.ok || data.error) {
        throw new Error(data.error ?? data.lastError ?? "Falha ao atualizar conexao");
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function syncCatalogNow() {
    setCatalogBusy(true);
    setCatalogMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/whatsapp/sync-catalog", {
        method: "POST"
      });
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Falha ao sincronizar catalogo");
      }

      setCatalogMessage(data.message ?? "Enviado para sincronizacao. Aguarde 1 a 3 minutos.");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro inesperado");
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 3000);

    return () => window.clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="card">Carregando...</div>;
  }

  const qrRecoveryMessage = getQrRecoveryMessage(session);
  const isTransientReconnect = isTransientReconnectStatus(session);
  const reconnectDisabled = busy || session?.status === "connecting" || session?.status === "qr";

  return (
    <section className="grid">
      <div className="card grid">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div className="segmented" role="tablist" aria-label="Instancias WhatsApp">
            <button className="active" type="button" role="tab" aria-selected="true">
              Instancia principal
            </button>
            <button
              disabled
              type="button"
              role="tab"
              aria-selected="false"
              title="Multi-instancia em preparacao"
            >
              Nova instancia
            </button>
          </div>
          <span className="badge warning">em preparacao</span>
        </div>
        <div className="muted">
          Multi-instancia requer isolamento por instanceId para sessao, filas, conversas, etiquetas
          e envios. A conexao atual continua usando apenas a instancia principal.
        </div>
      </div>

      <div className="card">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="muted">Status</div>
            <div className="stat-value">{session?.status ?? "disconnected"}</div>
            {session?.connectedPhone ? <div className="muted">{session.connectedPhone}</div> : null}
            {session?.updatedAt ? (
              <div className="muted">
                Atualizado em {new Date(session.updatedAt).toLocaleString("pt-BR")}
              </div>
            ) : null}
            {session?.latestMessageAt ? (
              <div className="muted">
                Ultima mensagem salva em{" "}
                {new Date(session.latestMessageAt).toLocaleString("pt-BR")}
              </div>
            ) : null}
          </div>
          <div className="button-row">
            <button
              className="button"
              disabled={reconnectDisabled}
              type="button"
              onClick={() => void postAction("/api/whatsapp/reconnect")}
            >
              Reconectar
            </button>
            <button
              className="button secondary"
              disabled={busy}
              type="button"
              onClick={() => void postAction("/api/whatsapp/disconnect")}
            >
              Desconectar
            </button>
            <button
              className="button danger"
              disabled={busy}
              type="button"
              onClick={() => void postAction("/api/whatsapp/reset-session")}
            >
              Resetar sessao
            </button>
          </div>
        </div>
      </div>

      <div className="card grid">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Modo X1 ativo</strong>
            <div className="muted">
              Grupos, broadcasts e newsletters sao ignorados para reduzir carga e focar envios
              para contatos individuais.
            </div>
          </div>
          <div className="button-row">
            <button className="button secondary" disabled type="button">
              Grupos ignorados
            </button>
            <Link className="button" href="/conversas">
              Abrir inbox
            </Link>
          </div>
        </div>
      </div>

      <div className="message">
        Use o reset de sessao se o QR nao aparecer ou se a sessao estiver corrompida. Depois
        clique em Reconectar.
      </div>

      <div className="message">
        A atualizacao automatica da inbox usa polling. Se novas mensagens nao aparecerem,
        verifique os logs do worker.
      </div>

      <div className="card grid">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Sincronizar catalogo agora</strong>
            <div className="muted">
              Carrega contatos, nomes e etiquetas sem salvar historico de mensagens.
            </div>
          </div>
          <button
            className="button"
            disabled={catalogBusy || session?.status === "qr"}
            type="button"
            onClick={() => void syncCatalogNow()}
          >
            {catalogBusy ? "Enviando..." : "Sincronizar catalogo agora"}
          </button>
        </div>
        {catalogMessage ? <div className="message success">{catalogMessage}</div> : null}
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {qrRecoveryMessage ? <div className="message error">{qrRecoveryMessage}</div> : null}
      {!qrRecoveryMessage && !isTransientReconnect && session?.lastError && session.status !== "error" ? (
        <div className="message error">{session.lastError}</div>
      ) : null}

      {isTransientReconnect ? (
        <div className="message">
          Reconectando com a sessao atual. Nao e necessario resetar nem ler QR agora.
        </div>
      ) : session?.status === "connecting" ? (
        <div className="message">
          Aguardando QR Code. Isso pode levar alguns segundos.
        </div>
      ) : null}

      {!qrRecoveryMessage && session?.status === "error" && session.lastError ? (
        <div className="message error">{session.lastError}</div>
      ) : null}

      {session?.status === "qr" && session.qrCode ? (
        <div className="card">
          <img className="qr" src={session.qrCode} alt="QR Code do WhatsApp" />
        </div>
      ) : null}
    </section>
  );
}
