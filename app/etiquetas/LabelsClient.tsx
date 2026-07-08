"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { appendInstanceIdToHref, getStoredActiveInstanceId } from "@/src/lib/client/active-instance";

type LabelSummary = {
  id: string;
  waLabelId: string;
  name: string;
  color: string | null;
  conversationCount: number;
  contactCount: number;
  groupCount: number;
  updatedAt: string;
  sendStats: {
    sent: number;
    failed: number;
    pending: number;
  };
  lastCampaign: {
    id: string;
    name: string;
    status: string;
    updatedAt: string;
  } | null;
};

type LabelsResponse = {
  metrics: {
    totalLabels: number;
    activeLabels: number;
    labeledChats: number;
    contactLabels: number;
    eligibleX1Contacts: number;
    groupLabels: number;
  };
  labels: LabelSummary[];
};

function labelColorStyle(color: string | null) {
  if (!color?.startsWith("color-")) {
    return undefined;
  }

  const index = Number(color.replace("color-", ""));

  if (Number.isNaN(index)) {
    return undefined;
  }

  const palette = [
    "#0f766e",
    "#175cd3",
    "#d97706",
    "#dc2626",
    "#6941c6",
    "#059669",
    "#c11574",
    "#3538cd"
  ];

  return {
    backgroundColor: palette[index % palette.length]
  };
}

function statusClass(status: string) {
  if (status === "completed") {
    return "success";
  }

  if (status === "canceled") {
    return "danger";
  }

  if (status === "running") {
    return "info";
  }

  return "warning";
}

export function LabelsClient() {
  const [activeInstanceId, setActiveInstanceId] = useState("");
  const [data, setData] = useState<LabelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActiveInstanceId(getStoredActiveInstanceId());
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (activeInstanceId) params.set("instanceId", activeInstanceId);
        const response = await fetch(`/api/etiquetas?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as LabelsResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "Falha ao carregar etiquetas");
        }

        setData(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
      } finally {
        setLoading(false);
      }
    })();
  }, [activeInstanceId]);

  if (loading) {
    return <div className="card">Carregando segmentos...</div>;
  }

  if (error) {
    return <div className="message error">{error}</div>;
  }

  const metrics = data?.metrics;

  return (
    <section className="grid">
      <div className="message">
        Segmentos vindos das etiquetas do WhatsApp. Grupos sao contados como ignorados e os
        contatos individuais continuam elegiveis para campanha.
      </div>

      <div className="inbox-metrics">
        <article className="metric-card">
          <span>Total etiquetas</span>
          <strong>{metrics?.totalLabels ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Etiquetas ativas</span>
          <strong>{metrics?.activeLabels ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Contatos etiquetados</span>
          <strong>{metrics?.labeledChats ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Contatos individuais</span>
          <strong>{metrics?.eligibleX1Contacts ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Grupos ignorados</span>
          <strong>{metrics?.groupLabels ?? 0}</strong>
        </article>
      </div>

      {data?.labels.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhuma etiqueta sincronizada ainda.</strong>
          <span>Conecte o WhatsApp e aguarde a sincronizacao automatica das etiquetas.</span>
        </div>
      ) : (
        <div className="label-segment-grid">
          {data?.labels.map((label) => (
            <article className="section-card label-segment-card" key={label.id}>
              <div className="label-segment-header">
                <span className="label-chip" style={labelColorStyle(label.color)}>
                  {label.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <h2>{label.name}</h2>
                  <p>Atualizada em {new Date(label.updatedAt).toLocaleString("pt-BR")}</p>
                </div>
              </div>

              <div className="row-meta">
                <span>{label.contactCount} contatos individuais</span>
                <span>{label.groupCount} grupos ignorados</span>
                <span>{label.sendStats.sent} enviados</span>
                {label.sendStats.failed > 0 ? <span>{label.sendStats.failed} falhas</span> : null}
              </div>

              {label.lastCampaign ? (
                <div className="message">
                  Ultimo envio: <strong>{label.lastCampaign.name}</strong>{" "}
                  <span className={`badge ${statusClass(label.lastCampaign.status)}`}>
                    {label.lastCampaign.status}
                  </span>
                </div>
              ) : (
                <div className="message">Nenhuma campanha registrada para este segmento.</div>
              )}

              <div className="button-row">
                <Link className="button secondary" href={appendInstanceIdToHref(`/etiquetas/${label.id}`, activeInstanceId)}>
                  Abrir contatos
                </Link>
                <Link className="button" href={appendInstanceIdToHref(`/campanhas?labelId=${label.id}`, activeInstanceId)}>
                  Criar campanha
                </Link>
                {label.lastCampaign ? (
                  <Link
                    className="button secondary"
                    href={appendInstanceIdToHref(`/envios?campaign=${label.lastCampaign.id}`, activeInstanceId)}
                  >
                    Ver historico
                  </Link>
                ) : (
                  <Link className="button secondary" href={appendInstanceIdToHref("/envios", activeInstanceId)}>
                    Ver envios
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}




