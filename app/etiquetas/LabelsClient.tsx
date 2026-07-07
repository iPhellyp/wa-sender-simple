"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type LabelSummary = {
  id: string;
  waLabelId: string;
  name: string;
  color: string | null;
  conversationCount: number;
  contactCount: number;
  groupCount: number;
  updatedAt: string;
};

type LabelsResponse = {
  metrics: {
    totalLabels: number;
    activeLabels: number;
    labeledChats: number;
    contactLabels: number;
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
    "#136f63",
    "#175cd3",
    "#9a6700",
    "#b42318",
    "#6941c6",
    "#067647",
    "#c11574",
    "#3538cd"
  ];

  return {
    backgroundColor: palette[index % palette.length]
  };
}

export function LabelsClient() {
  const [data, setData] = useState<LabelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/etiquetas", { cache: "no-store" });
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
  }, []);

  if (loading) {
    return <div className="card">Carregando etiquetas...</div>;
  }

  if (error) {
    return <div className="message error">{error}</div>;
  }

  const metrics = data?.metrics;

  return (
    <section className="grid">
      <p className="page-subtitle">Etiquetas sincronizadas do WhatsApp conectado</p>
      <div className="message">
        As etiquetas aparecem apos eventos do WhatsApp. Envie apenas para contatos com relacionamento
        e respeite opt-out. Lotes grandes podem aumentar risco de bloqueio.
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
          <span>Conversas etiquetadas</span>
          <strong>{metrics?.labeledChats ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Contatos etiquetados</span>
          <strong>{metrics?.contactLabels ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>Grupos etiquetados</span>
          <strong>{metrics?.groupLabels ?? 0}</strong>
        </article>
      </div>

      {data?.labels.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhuma etiqueta sincronizada ainda.</strong>
          <span>
            Conecte o WhatsApp e aguarde os eventos labels.edit / labels.association. Etiquetas antigas
            podem exigir novo pareamento.
          </span>
        </div>
      ) : (
        <div className="conversation-grid">
          {data?.labels.map((label) => (
            <article className="inbox-conversation-card label-card" key={label.id}>
              <span className="label-chip" style={labelColorStyle(label.color)}>
                {label.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="conversation-card-body">
                <strong>{label.name}</strong>
                <span className="conversation-card-meta">
                  <span>{label.conversationCount} conversas</span>
                  <span>{label.contactCount} contatos</span>
                  <span>{label.groupCount} grupos</span>
                </span>
                <span className="muted">
                  Atualizada em {new Date(label.updatedAt).toLocaleString("pt-BR")}
                </span>
                <span className="button-row">
                  <Link className="button secondary" href={`/etiquetas/${label.id}`}>
                    Abrir
                  </Link>
                  <Link className="button" href={`/etiquetas/${label.id}/enviar`}>
                    Criar envio
                  </Link>
                </span>
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
