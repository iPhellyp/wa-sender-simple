"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

type AudienceResponse = {
  label: { id: string; name: string };
  total: number;
  eligible: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  jidTypeCounts: Record<string, number>;
  recipientsPreview: Array<{
    chatId: string;
    jid: string;
    name: string | null;
    isGroup: boolean;
    phoneNormalized: string | null;
    jidType: string;
  }>;
  error?: string;
};

export function LabelSendClient({ labelId }: { labelId: string }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [excludeGroups, setExcludeGroups] = useState(true);
  const [excludeAlreadySentDays, setExcludeAlreadySentDays] = useState(7);
  const [maxRecipients, setMaxRecipients] = useState(100);
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [audience, setAudience] = useState<AudienceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  async function previewAudience() {
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const params = new URLSearchParams({
        excludeGroups: String(excludeGroups),
        excludeAlreadySentDays: String(excludeAlreadySentDays),
        maxRecipients: String(maxRecipients),
        limit: "50"
      });
      const response = await fetch(`/api/etiquetas/${labelId}/audience?${params.toString()}`);
      const data = (await response.json()) as AudienceResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao pre-visualizar publico");
      }

      setAudience(data);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function createCampaign(startNow: boolean) {
    if (!audience || audience.eligible === 0) {
      setError("Pre-visualize o publico antes de criar o envio");
      return;
    }

    const confirmed = window.confirm(
      `Voce esta prestes a enviar para ${audience.eligible} conversas. Ignorados: ${audience.skipped}. Confirma?`
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/etiquetas/${labelId}/campaigns`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          message,
          excludeGroups,
          excludeAlreadySentDays,
          maxRecipients,
          intervalMinutes,
          startNow
        })
      });
      const data = (await response.json()) as {
        campaign?: { id: string };
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao criar envio");
      }

      setCampaignId(data.campaign?.id ?? null);
      setSuccess(data.message ?? "Envio criado");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  function handlePreviewSubmit(event: FormEvent) {
    event.preventDefault();
    void previewAudience();
  }

  return (
    <section className="grid">
      <div className="button-row">
        <Link className="button secondary" href={`/etiquetas/${labelId}`}>
          Voltar
        </Link>
        {campaignId ? (
          <Link className="button" href={`/envios?campaign=${campaignId}`}>
            Abrir envio
          </Link>
        ) : null}
      </div>

      <div className="message">
        Envie apenas para contatos com relacionamento. Opt-out e sempre respeitado. Grupos ficam
        excluidos por padrao. Intervalo minimo de 1 minuto entre destinatarios.
      </div>

      <form className="card grid" onSubmit={handlePreviewSubmit}>
        <label>
          Nome da campanha
          <input
            className="input"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Mensagem
          <textarea
            className="input"
            required
            rows={5}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <label>
          Intervalo entre envios (minutos)
          <input
            className="input"
            min={1}
            required
            type="number"
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(Number(event.target.value))}
          />
        </label>
        <label className="checkbox-row">
          <input
            checked={excludeGroups}
            type="checkbox"
            onChange={(event) => setExcludeGroups(event.target.checked)}
          />
          <span>
            <strong>Ignorar grupos</strong>
            <span className="muted">
              Envia somente para contatos individuais. Grupos vinculados a etiqueta serao ignorados.
            </span>
          </span>
        </label>
        <label>
          Nao enviar para quem recebeu nos ultimos (dias)
          <input
            className="input"
            min={0}
            type="number"
            value={excludeAlreadySentDays}
            onChange={(event) => setExcludeAlreadySentDays(Number(event.target.value))}
          />
        </label>
        <label>
          Limite maximo de destinatarios
          <input
            className="input"
            max={500}
            min={1}
            type="number"
            value={maxRecipients}
            onChange={(event) => setMaxRecipients(Number(event.target.value))}
          />
        </label>
        <button className="button secondary" disabled={busy} type="submit">
          {busy ? "Processando..." : "Pre-visualizar publico"}
        </button>
      </form>

      {error ? <div className="message error">{error}</div> : null}
      {success ? <div className="message success">{success}</div> : null}

      {audience ? (
        <div className="card grid">
          <strong>Preview: {audience.label.name}</strong>
          <div className="inbox-metrics">
            <article className="metric-card">
              <span>Total na etiqueta</span>
              <strong>{audience.total}</strong>
            </article>
            <article className="metric-card">
              <span>Elegiveis</span>
              <strong>{audience.eligible}</strong>
            </article>
            <article className="metric-card">
              <span>Ignorados</span>
              <strong>{audience.skipped}</strong>
            </article>
            <article className="metric-card">
              <span>Grupos ignorados</span>
              <strong>{audience.skippedReasons.group_excluded ?? 0}</strong>
            </article>
            <article className="metric-card">
              <span>Contatos @lid</span>
              <strong>{audience.jidTypeCounts.lid_jid ?? 0}</strong>
            </article>
            <article className="metric-card">
              <span>Contatos telefone</span>
              <strong>{audience.jidTypeCounts.phone_jid ?? 0}</strong>
            </article>
            <article className="metric-card">
              <span>JIDs invalidos</span>
              <strong>{audience.skippedReasons.invalid_jid ?? 0}</strong>
            </article>
            <article className="metric-card">
              <span>Sem conversa resolvida</span>
              <strong>{audience.skippedReasons.unresolved_chat ?? 0}</strong>
            </article>
            <article className="metric-card">
              <span>Broadcast/status</span>
              <strong>{audience.skippedReasons.broadcast_or_status ?? 0}</strong>
            </article>
            <article className="metric-card">
              <span>Duplicados</span>
              <strong>{audience.skippedReasons.duplicate_in_campaign ?? 0}</strong>
            </article>
          </div>
          <div className="muted">
            Motivos:{" "}
            {Object.entries(audience.skippedReasons)
              .filter(([, count]) => count > 0)
              .map(([reason, count]) => `${reason}=${count}`)
              .join(", ") || "nenhum"}
          </div>
          <ul className="list-plain">
            {audience.recipientsPreview.map((recipient) => (
              <li key={recipient.jid}>
                {recipient.name ?? recipient.phoneNormalized ?? recipient.jid}{" "}
                <span className="muted">
                  (
                  {recipient.isGroup
                    ? "grupo"
                    : recipient.jidType === "lid_jid"
                      ? "@lid"
                      : recipient.phoneNormalized ?? "contato"}
                  )
                </span>
              </li>
            ))}
          </ul>
          <div className="button-row">
            <button
              className="button"
              disabled={busy || audience.eligible === 0}
              type="button"
              onClick={() => void createCampaign(false)}
            >
              Criar envio (rascunho)
            </button>
            <button
              className="button danger"
              disabled={busy || audience.eligible === 0}
              type="button"
              onClick={() => void createCampaign(true)}
            >
              Criar e iniciar envio
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
