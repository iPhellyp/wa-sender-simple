"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type EnvioSummary = {
  id: string;
  name: string;
  status: string;
  targetMode: string;
  targetLabel: { id: string; name: string; color: string | null } | null;
  recipientCount: number;
  recipientStatusCounts: Record<string, number>;
  skippedReasonCounts: Record<string, number>;
  createdAt: string;
};

function statusClass(status: string) {
  if (["sent", "completed", "connected"].includes(status)) {
    return "success";
  }

  if (["failed", "canceled", "error"].includes(status)) {
    return "danger";
  }

  if (["running", "sending", "scheduled"].includes(status)) {
    return "info";
  }

  return "warning";
}

export function EnviosClient({ selectedCampaignId }: { selectedCampaignId?: string | null }) {
  const [campaigns, setCampaigns] = useState<EnvioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(selectedCampaignId ?? null);
  const [details, setDetails] = useState<{
    recipients: Array<{
      id: string;
      jid: string | null;
      status: string;
      skippedReason: string | null;
      error: string | null;
      sentAt: string | null;
      contact: { name: string; phoneNormalized: string } | null;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCampaigns() {
    const response = await fetch("/api/envios", { cache: "no-store" });
    const data = (await response.json()) as { campaigns: EnvioSummary[] };
    setCampaigns(data.campaigns);
  }

  async function loadDetails(campaignId: string) {
    const response = await fetch(`/api/envios/${campaignId}`, { cache: "no-store" });
    const data = (await response.json()) as {
      campaign: {
        recipients: Array<{
          id: string;
          jid: string | null;
          status: string;
          skippedReason: string | null;
          error: string | null;
          sentAt: string | null;
          contact: { name: string; phoneNormalized: string } | null;
        }>;
      };
    };
    setDetails({ recipients: data.campaign.recipients });
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadCampaigns();
        if (selectedCampaignId) {
          setSelectedId(selectedCampaignId);
          await loadDetails(selectedCampaignId);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedCampaignId]);

  async function runCampaignAction(campaignId: string, action: "start" | "pause" | "cancel") {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/${action}`, {
        method: "POST"
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `Falha ao ${action} campanha`);
      }

      await loadCampaigns();
      if (selectedId === campaignId) {
        await loadDetails(campaignId);
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="card">Carregando envios...</div>;
  }

  return (
    <section className="grid">
      {error ? <div className="message error">{error}</div> : null}

      <div className="conversation-grid">
        {campaigns.map((campaign) => (
          <article className="inbox-conversation-card label-card" key={campaign.id}>
            <span className="conversation-card-body">
              <strong>{campaign.name}</strong>
              <span className={`badge ${statusClass(campaign.status)}`}>{campaign.status}</span>
              <span className="conversation-card-meta">
                <span>{campaign.targetMode === "label" ? "por etiqueta" : "manual"}</span>
                {campaign.targetLabel ? <span>{campaign.targetLabel.name}</span> : null}
                <span>{campaign.recipientCount} destinatarios</span>
                <span>enviados {campaign.recipientStatusCounts.sent ?? 0}</span>
                <span>falhas {campaign.recipientStatusCounts.failed ?? 0}</span>
              </span>
              <span className="button-row">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setSelectedId(campaign.id);
                    void loadDetails(campaign.id);
                  }}
                >
                  Abrir detalhes
                </button>
                {campaign.status === "draft" ? (
                  <button
                    className="button"
                    disabled={busy}
                    type="button"
                    onClick={() => void runCampaignAction(campaign.id, "start")}
                  >
                    Iniciar
                  </button>
                ) : null}
                {campaign.status === "running" ? (
                  <button
                    className="button secondary"
                    disabled={busy}
                    type="button"
                    onClick={() => void runCampaignAction(campaign.id, "pause")}
                  >
                    Pausar
                  </button>
                ) : null}
              </span>
            </span>
          </article>
        ))}
      </div>

      {selectedId && details ? (
        <div className="card grid">
          <strong>Destinatarios</strong>
          <ul className="list-plain">
            {details.recipients.map((recipient) => (
              <li key={recipient.id}>
                {recipient.contact?.name ?? recipient.jid ?? recipient.id} — {recipient.status}
                {recipient.skippedReason ? ` (${recipient.skippedReason})` : ""}
                {recipient.error ? ` — ${recipient.error}` : ""}
              </li>
            ))}
          </ul>
          <Link className="button secondary" href="/campanhas">
            Abrir campanhas legado
          </Link>
        </div>
      ) : null}
    </section>
  );
}
