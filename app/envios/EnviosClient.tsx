"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type EnvioSummary = {
  id: string;
  name: string;
  status: string;
  targetMode: string;
  targetLabel: { id: string; name: string; color: string | null } | null;
  recipientCount: number;
  recipientStatusCounts: Record<string, number>;
  skippedReasonCounts: Record<string, number>;
  intervalMinutes: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type RecipientDetail = {
  id: string;
  jid: string | null;
  messageFinal: string;
  status: string;
  skippedReason: string | null;
  error: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  updatedAt: string;
  contact: { name: string; phoneNormalized: string } | null;
};

type CampaignDetails = {
  id: string;
  name: string;
  status: string;
  targetMode: string;
  targetLabel: { id: string; name: string; color: string | null } | null;
  recipients: RecipientDetail[];
};

function statusClass(status: string) {
  if (["sent", "completed", "connected"].includes(status)) return "success";
  if (["failed", "canceled", "error"].includes(status)) return "danger";
  if (["running", "sending", "scheduled"].includes(status)) return "info";
  return "warning";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function inPeriod(createdAt: string, period: string) {
  if (period === "all") return true;

  const created = new Date(createdAt).getTime();
  const now = Date.now();
  const days = period === "today" ? 1 : period === "7d" ? 7 : 30;
  return created >= now - days * 24 * 60 * 60 * 1000;
}

export function EnviosClient({ selectedCampaignId }: { selectedCampaignId?: string | null }) {
  const [campaigns, setCampaigns] = useState<EnvioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(selectedCampaignId ?? null);
  const [details, setDetails] = useState<CampaignDetails | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredCampaigns = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return campaigns.filter((campaign) => {
      if (statusFilter !== "all" && campaign.status !== statusFilter) return false;
      if (!inPeriod(campaign.createdAt, periodFilter)) return false;
      if (!normalizedSearch) return true;

      return (
        campaign.name.toLowerCase().includes(normalizedSearch) ||
        campaign.targetMode.toLowerCase().includes(normalizedSearch) ||
        (campaign.targetLabel?.name.toLowerCase().includes(normalizedSearch) ?? false)
      );
    });
  }, [campaigns, periodFilter, search, statusFilter]);

  const totals = useMemo(() => {
    return filteredCampaigns.reduce(
      (accumulator, campaign) => {
        accumulator.campaigns += 1;
        accumulator.recipients += campaign.recipientCount;
        accumulator.sent += campaign.recipientStatusCounts.sent ?? 0;
        accumulator.failed += campaign.recipientStatusCounts.failed ?? 0;
        accumulator.pending +=
          (campaign.recipientStatusCounts.pending ?? 0) +
          (campaign.recipientStatusCounts.scheduled ?? 0) +
          (campaign.recipientStatusCounts.sending ?? 0);
        return accumulator;
      },
      { campaigns: 0, recipients: 0, sent: 0, failed: 0, pending: 0 }
    );
  }, [filteredCampaigns]);

  const detailGroups = useMemo(() => {
    const recipients = details?.recipients ?? [];
    return {
      sent: recipients.filter((recipient) => recipient.status === "sent"),
      failed: recipients.filter((recipient) => recipient.status === "failed"),
      pending: recipients.filter((recipient) =>
        ["pending", "scheduled", "sending"].includes(recipient.status)
      )
    };
  }, [details]);

  async function loadCampaigns() {
    const response = await fetch("/api/envios", { cache: "no-store" });
    const data = (await response.json()) as { campaigns: EnvioSummary[] };
    setCampaigns(data.campaigns);
  }

  async function loadDetails(campaignId: string) {
    const response = await fetch(`/api/envios/${campaignId}`, { cache: "no-store" });
    const data = (await response.json()) as { campaign?: CampaignDetails; error?: string };
    if (!response.ok || !data.campaign) {
      throw new Error(String(data.error ?? "Erro ao carregar detalhes"));
    }
    setDetails(data.campaign);
  }

  async function refresh() {
    await loadCampaigns();
    if (selectedId) await loadDetails(selectedId);
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

  async function runCampaignAction(campaignId: string, action: "start" | "pause" | "resume" | "cancel") {
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

      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="section-card">Carregando envios...</div>;
  }

  return (
    <section className="grid">
      <div className="page-header">
        <div>
          <span className="eyebrow">Auditoria de campanhas</span>
          <h1>Envios</h1>
          <p>Historico operacional por campanha, com destinatarios enviados, pendentes e falhos.</p>
        </div>
        <Link className="button" href="/campanhas">
          Criar campanha
        </Link>
      </div>

      {error ? <div className="message error">{error}</div> : null}

      <div className="stats-grid">
        <div className="stat-card">
          <span>Campanhas</span>
          <strong>{totals.campaigns}</strong>
        </div>
        <div className="stat-card">
          <span>Destinatarios</span>
          <strong>{totals.recipients}</strong>
        </div>
        <div className="stat-card">
          <span>Enviados</span>
          <strong>{totals.sent}</strong>
        </div>
        <div className="stat-card">
          <span>Falhas</span>
          <strong>{totals.failed}</strong>
        </div>
        <div className="stat-card">
          <span>Pendentes</span>
          <strong>{totals.pending}</strong>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Buscar campanha ou etiqueta"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Todos os status</option>
          <option value="draft">Rascunho</option>
          <option value="running">Rodando</option>
          <option value="paused">Pausada</option>
          <option value="completed">Completa</option>
          <option value="canceled">Cancelada</option>
        </select>
        <select className="input" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
          <option value="all">Todo periodo</option>
          <option value="today">Hoje</option>
          <option value="7d">Ultimos 7 dias</option>
          <option value="30d">Ultimos 30 dias</option>
        </select>
        <button className="button secondary" type="button" onClick={() => void refresh()}>
          Atualizar
        </button>
      </div>

      <section className="grid two-column">
        <div className="section-card">
          <div className="toolbar">
            <strong>Campanhas</strong>
            <span className="muted">{filteredCampaigns.length} resultado(s)</span>
          </div>
          <div className="conversation-grid">
            {filteredCampaigns.map((campaign) => (
              <article className="inbox-conversation-card label-card" key={campaign.id}>
                <span className="conversation-card-body">
                  <span className="toolbar">
                    <strong>{campaign.name}</strong>
                    <span className={`badge ${statusClass(campaign.status)}`}>{campaign.status}</span>
                  </span>
                  <span className="conversation-card-meta">
                    <span>{campaign.targetLabel?.name ?? campaign.targetMode}</span>
                    <span>{campaign.recipientCount} destinatarios</span>
                    <span>sent {campaign.recipientStatusCounts.sent ?? 0}</span>
                    <span>failed {campaign.recipientStatusCounts.failed ?? 0}</span>
                    <span>pending {(campaign.recipientStatusCounts.pending ?? 0) + (campaign.recipientStatusCounts.scheduled ?? 0)}</span>
                    <span>criada {formatDate(campaign.createdAt)}</span>
                    {(campaign.skippedReasonCounts.group_excluded ?? 0) > 0 ? (
                      <span>grupos ignorados {campaign.skippedReasonCounts.group_excluded}</span>
                    ) : null}
                    {(campaign.skippedReasonCounts.invalid_jid ?? 0) > 0 ? (
                      <span>JIDs invalidos {campaign.skippedReasonCounts.invalid_jid}</span>
                    ) : null}
                  </span>
                  <span className="button-row">
                    <button
                      className="button secondary compact-button"
                      type="button"
                      onClick={() => {
                        setSelectedId(campaign.id);
                        void loadDetails(campaign.id);
                      }}
                    >
                      Detalhes
                    </button>
                    {campaign.status === "draft" ? (
                      <button
                        className="button compact-button"
                        disabled={busy}
                        type="button"
                        onClick={() => void runCampaignAction(campaign.id, "start")}
                      >
                        Iniciar
                      </button>
                    ) : null}
                    {campaign.status === "paused" ? (
                      <button
                        className="button compact-button"
                        disabled={busy}
                        type="button"
                        onClick={() => void runCampaignAction(campaign.id, "resume")}
                      >
                        Retomar
                      </button>
                    ) : null}
                    {campaign.status === "running" ? (
                      <button
                        className="button secondary compact-button"
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
            {filteredCampaigns.length === 0 ? <div className="muted">Nenhuma campanha encontrada.</div> : null}
          </div>
        </div>

        <aside className="section-card">
          <div className="toolbar">
            <strong>Detalhes</strong>
            {details ? <span className={`badge ${statusClass(details.status)}`}>{details.status}</span> : null}
          </div>
          {details ? (
            <div className="grid">
              <div>
                <h2 style={{ fontSize: 18, margin: 0 }}>{details.name}</h2>
                <p className="muted">
                  {details.targetLabel?.name ?? details.targetMode} | sent {detailGroups.sent.length} | failed{" "}
                  {detailGroups.failed.length} | pending {detailGroups.pending.length}
                </p>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Destinatario</th>
                      <th>Status</th>
                      <th>Quando</th>
                      <th>Erro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {details.recipients.map((recipient) => (
                      <tr key={recipient.id}>
                        <td>
                          <strong>{recipient.contact?.name ?? recipient.jid ?? recipient.id}</strong>
                          <br />
                          <span className="muted">{recipient.contact?.phoneNormalized ?? recipient.jid}</span>
                        </td>
                        <td>
                          <span className={`badge ${statusClass(recipient.status)}`}>{recipient.status}</span>
                          {recipient.skippedReason ? <div className="muted">{recipient.skippedReason}</div> : null}
                        </td>
                        <td>{formatDate(recipient.sentAt ?? recipient.scheduledAt ?? recipient.updatedAt)}</td>
                        <td>{recipient.error ? <span className="message error">{recipient.error}</span> : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="muted">Selecione uma campanha para auditar destinatarios.</div>
          )}
        </aside>
      </section>
    </section>
  );
}
