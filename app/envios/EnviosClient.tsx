"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getStoredActiveInstanceId } from "@/src/lib/client/active-instance";

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

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "rascunho",
    running: "rodando",
    paused: "pausada",
    completed: "completa",
    canceled: "cancelada",
    pending: "pendente",
    scheduled: "agendado",
    sending: "enviando",
    sent: "enviado",
    failed: "falhou"
  };

  return labels[status] ?? status;
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

function getPendingCount(counts: Record<string, number>) {
  return (counts.pending ?? 0) + (counts.scheduled ?? 0) + (counts.sending ?? 0);
}

function getAudienceLabel(campaign: Pick<EnvioSummary, "targetLabel" | "targetMode">) {
  if (campaign.targetLabel) return campaign.targetLabel.name;
  if (campaign.targetMode === "chatIds") return "Contatos WhatsApp";
  if (campaign.targetMode === "contacts") return "Contatos importados";
  if (campaign.targetMode === "label") return "Etiqueta WhatsApp";
  return campaign.targetMode;
}

export function EnviosClient({ selectedCampaignId }: { selectedCampaignId?: string | null }) {
  const searchParams = useSearchParams();
  const activeInstanceId = searchParams.get("instanceId") ?? getStoredActiveInstanceId();
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
        accumulator.pending += getPendingCount(campaign.recipientStatusCounts);
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

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedId) ?? null;
  const detailTotal = details?.recipients.length ?? 0;
  const progressPercent = detailTotal > 0 ? Math.round((detailGroups.sent.length / detailTotal) * 100) : 0;

  async function loadCampaigns() {
    const params = new URLSearchParams();
    if (activeInstanceId) params.set("instanceId", activeInstanceId);
    const response = await fetch(`/api/envios?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as { campaigns: EnvioSummary[] };
    setCampaigns(data.campaigns);
  }

  async function loadDetails(campaignId: string) {
    const params = new URLSearchParams();
    if (activeInstanceId) params.set("instanceId", activeInstanceId);
    const response = await fetch(`/api/envios/${campaignId}?${params.toString()}`, { cache: "no-store" });
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

  async function refreshWithErrorHandling() {
    setBusy(true);
    setError(null);
    try {
      await refresh();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
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
  }, [selectedCampaignId, activeInstanceId]);

  async function runCampaignAction(campaignId: string, action: "start" | "pause" | "resume" | "cancel") {
    setBusy(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`/api/campaigns/${campaignId}/${action}?${params.toString()}`, {
        method: "POST"
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `Falha ao atualizar campanha`);
      }

      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="data-card compact">Carregando envios...</div>;
  }

  return (
    <section className="page-shell">
      {error ? <div className="message error compact">{error}</div> : null}

      <div className="metric-grid">
        <article className="metric-card compact">
          <span>Campanhas</span>
          <strong>{totals.campaigns}</strong>
        </article>
        <article className="metric-card compact">
          <span>Destinatarios</span>
          <strong>{totals.recipients}</strong>
        </article>
        <article className="metric-card compact">
          <span>Enviados</span>
          <strong>{totals.sent}</strong>
        </article>
        <article className="metric-card compact">
          <span>Falhas</span>
          <strong>{totals.failed}</strong>
        </article>
        <article className="metric-card compact">
          <span>Pendentes</span>
          <strong>{totals.pending}</strong>
        </article>
      </div>

      <div className="data-card compact">
        <div className="filter-bar">
          <input
            className="input"
            placeholder="Buscar campanha ou etiqueta"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">Todos os status</option>
            <option value="draft">Rascunho</option>
            <option value="running">Rodando</option>
            <option value="paused">Pausada</option>
            <option value="completed">Completa</option>
            <option value="canceled">Cancelada</option>
          </select>
          <select
            className="select"
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
          >
            <option value="all">Todo periodo</option>
            <option value="today">Hoje</option>
            <option value="7d">Ultimos 7 dias</option>
            <option value="30d">Ultimos 30 dias</option>
          </select>
          <button
            className="button secondary"
            disabled={busy}
            type="button"
            onClick={() => void refreshWithErrorHandling()}
          >
            Atualizar
          </button>
        </div>
      </div>

      <section className="split-layout">
        <div className="data-card">
          <div className="table-toolbar">
            <div>
              <strong>Campanhas</strong>
              <span className="muted">{filteredCampaigns.length} resultado(s)</span>
            </div>
          </div>

          {filteredCampaigns.length === 0 ? (
            <div className="empty-state compact">
              <strong>Nenhuma campanha encontrada</strong>
              <span>Ajuste os filtros ou crie uma nova campanha.</span>
              <Link className="button compact-button" href={activeInstanceId ? `/campanhas?instanceId=${activeInstanceId}` : "/campanhas"}>
                Criar campanha
              </Link>
            </div>
          ) : (
            <div className="campaign-list">
              {filteredCampaigns.map((campaign) => {
                const pending = getPendingCount(campaign.recipientStatusCounts);
                const isSelected = selectedId === campaign.id;

                return (
                  <article className={`campaign-row ${isSelected ? "active" : ""}`} key={campaign.id}>
                    <div className="campaign-row-main">
                      <div>
                        <strong>{campaign.name}</strong>
                        <span className="muted">{getAudienceLabel(campaign)}</span>
                      </div>
                      <span className={`status-badge ${statusClass(campaign.status)}`}>
                        {statusLabel(campaign.status)}
                      </span>
                    </div>
                    <div className="row-meta">
                      <span>{campaign.recipientCount} destinatarios</span>
                      <span>{campaign.recipientStatusCounts.sent ?? 0} enviados</span>
                      <span>{campaign.recipientStatusCounts.failed ?? 0} falhas</span>
                      <span>{pending} pendentes</span>
                      <span>criada {formatDate(campaign.createdAt)}</span>
                    </div>
                    <div className="button-row">
                      <button
                        className="button secondary compact-button"
                        type="button"
                        onClick={() => {
                          setSelectedId(campaign.id);
                          void loadDetails(campaign.id);
                        }}
                      >
                        Ver detalhes
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
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="detail-panel">
          {details ? (
            <div className="detail-stack">
              <div className="detail-heading">
                <div>
                  <strong>{details.name}</strong>
                  <span className="muted">{details.targetLabel?.name ?? details.targetMode}</span>
                </div>
                <span className={`status-badge ${statusClass(details.status)}`}>
                  {statusLabel(details.status)}
                </span>
              </div>

              <div className="progress-block">
                <div className="progress-row">
                  <span>Progresso</span>
                  <strong>{progressPercent}%</strong>
                </div>
                <div className="progress-track">
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              <div className="detail-metrics">
                <span>{detailTotal} total</span>
                <span>{detailGroups.sent.length} enviados</span>
                <span>{detailGroups.failed.length} falhas</span>
                <span>{detailGroups.pending.length} pendentes</span>
              </div>

              {selectedCampaign ? (
                <div className="button-row">
                  {selectedCampaign.status === "draft" ? (
                    <button
                      className="button compact-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void runCampaignAction(selectedCampaign.id, "start")}
                    >
                      Iniciar agora
                    </button>
                  ) : null}
                  {selectedCampaign.status === "paused" ? (
                    <button
                      className="button compact-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void runCampaignAction(selectedCampaign.id, "resume")}
                    >
                      Retomar
                    </button>
                  ) : null}
                  {selectedCampaign.status === "running" ? (
                    <button
                      className="button secondary compact-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void runCampaignAction(selectedCampaign.id, "pause")}
                    >
                      Pausar
                    </button>
                  ) : null}
                  {!["completed", "canceled"].includes(selectedCampaign.status) ? (
                    <button
                      className="button danger compact-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void runCampaignAction(selectedCampaign.id, "cancel")}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div>
                <strong>Destinatarios recentes</strong>
                <div className="table-wrap">
                  <table className="data-table compact">
                    <thead>
                      <tr>
                        <th>Destinatario</th>
                        <th>Status</th>
                        <th>Quando</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.recipients.slice(0, 10).map((recipient) => (
                        <tr key={recipient.id}>
                          <td>
                            <div className="identity-cell">
                              <strong>{recipient.contact?.name ?? recipient.jid ?? recipient.id}</strong>
                              <span className="muted">
                                {recipient.contact?.phoneNormalized ?? recipient.jid ?? "-"}
                              </span>
                              {recipient.error ? <span className="send-error">{recipient.error}</span> : null}
                            </div>
                          </td>
                          <td>
                            <span className={`status-badge ${statusClass(recipient.status)}`}>
                              {statusLabel(recipient.status)}
                            </span>
                          </td>
                          <td>{formatDate(recipient.sentAt ?? recipient.scheduledAt ?? recipient.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>Selecione uma campanha</strong>
              <span>Os detalhes de progresso, falhas e destinatarios recentes aparecerao aqui.</span>
            </div>
          )}
        </aside>
      </section>
    </section>
  );
}
