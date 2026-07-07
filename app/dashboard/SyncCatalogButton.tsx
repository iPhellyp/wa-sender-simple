"use client";

import { useState } from "react";

export function SyncCatalogButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function syncCatalog() {
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/whatsapp/sync-catalog", {
        method: "POST"
      });
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Falha ao sincronizar catalogo");
      }

      setMessage(data.message ?? "Resync enviado.");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sync-inline">
      <button className="button" disabled={busy} type="button" onClick={() => void syncCatalog()}>
        {busy ? "Enviando..." : "Sincronizar catálogo"}
      </button>
      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
