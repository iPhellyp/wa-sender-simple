"use client";

import { useState } from "react";

type SyncHistoryResponse = {
  ok?: boolean;
  mode?: string;
  message?: string;
  error?: string;
};

const SUCCESS_MESSAGE =
  "Verificacao enfileirada. O sistema salva o historico que o WhatsApp entregar por eventos; busca antiga completa depende de cursor seguro.";

export function SyncHistoryButton({ instanceId }: { instanceId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (busy) {
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/whatsapp/sync-history?instanceId=${encodeURIComponent(instanceId)}`, {
        method: "POST"
      });
      const data = (await response.json()) as SyncHistoryResponse;

      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? "Erro ao verificar historico");
      }

      if (data.ok === false) {
        throw new Error(data.message ?? "WhatsApp nao esta conectado. Reconecte primeiro.");
      }

      setMessage(data.message ?? SUCCESS_MESSAGE);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="popover-action">
      <button className="button secondary" disabled={busy} type="button" onClick={() => void handleClick()}>
        {busy ? "Enfileirando..." : "Verificar historico"}
      </button>
      {message ? <div className="compact-note success">{message}</div> : null}
      {error ? <div className="compact-note error">{error}</div> : null}
    </div>
  );
}

