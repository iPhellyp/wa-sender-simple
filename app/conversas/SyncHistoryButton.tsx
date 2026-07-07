"use client";

import { useState } from "react";

type SyncHistoryResponse = {
  ok?: boolean;
  mode?: string;
  message?: string;
  error?: string;
};

const SUCCESS_MESSAGE =
  "Verificacao solicitada. O WhatsApp so envia historico completo durante eventos proprios ou novo pareamento.";
const GUIDANCE_MESSAGE =
  "Para tentar historico completo antigo, use WhatsApp > Resetar sessao > Reconectar.";

export function SyncHistoryButton() {
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
      const response = await fetch("/api/whatsapp/sync-history", {
        method: "POST"
      });
      const data = (await response.json()) as SyncHistoryResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao verificar historico");
      }

      if (data.ok === false) {
        throw new Error(data.message ?? "WhatsApp nao esta conectado. Reconecte primeiro.");
      }

      setMessage(`${SUCCESS_MESSAGE} ${GUIDANCE_MESSAGE}`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="popover-action">
      <button className="button secondary" disabled={busy} type="button" onClick={() => void handleClick()}>
        {busy ? "Verificando..." : "Verificar historico"}
      </button>
      {message ? <div className="compact-note success">{message}</div> : null}
      {error ? <div className="compact-note error">{error}</div> : null}
    </div>
  );
}
