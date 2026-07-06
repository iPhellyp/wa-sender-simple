"use client";

import { useState } from "react";

type SyncHistoryResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export function SyncHistoryButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/whatsapp/sync-history", {
        method: "POST"
      });
      const data = (await response.json()) as SyncHistoryResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao solicitar sincronizacao");
      }

      setMessage(data.message ?? "Solicitacao enviada ao worker");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="popover-action">
      <button className="button secondary" disabled={busy} type="button" onClick={() => void handleClick()}>
        {busy ? "Sincronizando..." : "Sincronizar historico"}
      </button>
      {message ? <div className="compact-note success">{message}</div> : null}
      {error ? <div className="compact-note error">{error}</div> : null}
    </div>
  );
}
