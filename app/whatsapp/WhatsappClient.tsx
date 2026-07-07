"use client";

import { useEffect, useState } from "react";

type WhatsappSession = {
  id: string;
  status: string;
  qrCode: string | null;
  hasQrCode: boolean;
  connectedPhone: string | null;
  lastError: string | null;
  updatedAt: string;
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

export function WhatsappClient() {
  const [session, setSession] = useState<WhatsappSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
  const reconnectDisabled = busy || session?.status === "connecting" || session?.status === "qr";

  return (
    <section className="grid">
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

      <div className="message">
        Use o reset de sessao se o QR nao aparecer ou se a sessao estiver corrompida. Depois
        clique em Reconectar.
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {qrRecoveryMessage ? <div className="message error">{qrRecoveryMessage}</div> : null}
      {!qrRecoveryMessage && session?.lastError && session.status !== "error" ? (
        <div className="message error">{session.lastError}</div>
      ) : null}

      {session?.status === "connecting" ? (
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
