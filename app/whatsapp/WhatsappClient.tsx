"use client";

import { useEffect, useState } from "react";

type WhatsappSession = {
  status: string;
  qrCode: string | null;
  connectedPhone: string | null;
  lastError: string | null;
};

export function WhatsappClient() {
  const [session, setSession] = useState<WhatsappSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
    const data = (await response.json()) as WhatsappSession;
    setSession(data);
    setLoading(false);
  }

  async function postAction(path: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error("Falha ao atualizar conexao");
      }

      setSession((await response.json()) as WhatsappSession);
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
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="card">Carregando...</div>;
  }

  return (
    <section className="grid">
      <div className="card">
        <div className="button-row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="muted">Status</div>
            <div className="stat-value">{session?.status ?? "disconnected"}</div>
            {session?.connectedPhone ? <div className="muted">{session.connectedPhone}</div> : null}
          </div>
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
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
          </div>
        </div>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {session?.lastError ? <div className="message error">{session.lastError}</div> : null}

      {session?.qrCode ? (
        <div className="card">
          <img className="qr" src={session.qrCode} alt="QR Code do WhatsApp" />
        </div>
      ) : null}
    </section>
  );
}
