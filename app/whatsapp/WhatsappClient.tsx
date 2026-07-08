"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/app/components/ui/ButtonLink";
import { SectionCard } from "@/app/components/ui/SectionCard";
import { StatusBadge, statusToneFromValue } from "@/app/components/ui/StatusBadge";

type WhatsappSession = {
  id: string;
  status: string;
  qrCode: string | null;
  hasQrCode: boolean;
  connectedPhone: string | null;
  lastError: string | null;
  updatedAt: string;
  latestMessageAt?: string | null;
  message?: string;
  error?: string;
};

function getQrRecoveryMessage(session: WhatsappSession | null) {
  if (
    !session?.lastError ||
    (session.status !== "error" && session.status !== "disconnected") ||
    !/(428|qr)/i.test(session.lastError)
  ) {
    return null;
  }

  return "Nao foi possivel gerar QR. Clique Resetar sessao uma vez e depois Reconectar. Se persistir, o sistema usara modo QR seguro.";
}

function isTransientReconnectStatus(session: WhatsappSession | null) {
  return (
    session?.status === "connecting" &&
    /reconectando apos queda transitoria/i.test(session.lastError ?? "")
  );
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem registro";
}

export function WhatsappClient() {
  const searchParams = useSearchParams();
  const activeInstanceId = searchParams.get("instanceId") ?? "";
  const [session, setSession] = useState<WhatsappSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    try {
      const params = new URLSearchParams();
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`/api/whatsapp/status?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as WhatsappSession;

      if (!response.ok) {
        throw new Error(data.error ?? "Falha ao carregar status do WhatsApp");
      }

      setSession(data);
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function postAction(path: string) {
    setBusy(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`${path}?${params.toString()}`, {
        method: "POST"
      });

      const data = (await response.json()) as WhatsappSession;
      setSession(data);

      if (!response.ok || data.error) {
        throw new Error(data.error ?? data.lastError ?? "Falha ao atualizar conexao");
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function syncCatalogNow() {
    setCatalogBusy(true);
    setCatalogMessage(null);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`/api/whatsapp/sync-catalog?${params.toString()}`, {
        method: "POST"
      });
      const data = (await response.json()) as { message?: string; error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Falha ao sincronizar catalogo");
      }

      setCatalogMessage(data.message ?? "Enviado para sincronizacao. Aguarde 1 a 3 minutos.");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Erro inesperado");
    } finally {
      setCatalogBusy(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 3000);

    return () => window.clearInterval(interval);
  }, [activeInstanceId]);

  if (loading) {
    return <div className="card">Carregando...</div>;
  }

  const qrRecoveryMessage = getQrRecoveryMessage(session);
  const isTransientReconnect = isTransientReconnectStatus(session);
  const reconnectDisabled = busy || session?.status === "connecting" || session?.status === "qr";
  const status = session?.status ?? "disconnected";
  const statusTone = statusToneFromValue(status);

  return (
    <section className="whatsapp-page">
      <div className="whatsapp-health-grid">
        <SectionCard
          title="Saude da conexao"
          description="Instancia principal usada para contatos, etiquetas e campanhas."
        >
          <div className="health-panel">
            <div className="health-status">
              <span className={`status-dot ${statusTone}`} aria-hidden="true" />
              <StatusBadge tone={statusTone}>{status}</StatusBadge>
              {isTransientReconnect ? (
                <StatusBadge tone="info">reconectando com sessao atual</StatusBadge>
              ) : null}
            </div>

            <div className="meta-list">
              <div className="meta-row">
                <span>Telefone conectado</span>
                <span>{session?.connectedPhone ?? "Nao conectado"}</span>
              </div>
              <div className="meta-row">
                <span>Ultima atualizacao</span>
                <span>{formatDateTime(session?.updatedAt)}</span>
              </div>
              <div className="meta-row">
                <span>Ultima mensagem salva</span>
                <span>{formatDateTime(session?.latestMessageAt)}</span>
              </div>
              <div className="meta-row">
                <span>QR disponivel</span>
                <span>{session?.hasQrCode ? "Sim" : "Nao"}</span>
              </div>
            </div>

            <div className="whatsapp-actions">
              <button
                className="button"
                disabled={reconnectDisabled}
                type="button"
                onClick={() => void postAction("/api/whatsapp/reconnect")}
              >
                Reconectar
              </button>
              <button
                className="button secondary"
                disabled={busy}
                type="button"
                onClick={() => void postAction("/api/whatsapp/disconnect")}
              >
                Desconectar
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Contatos individuais"
          description="O produto opera como base de contatos e sender por etiquetas, nao como inbox pesada."
          actions={<ButtonLink href="/conversas">Abrir conversas</ButtonLink>}
        >
          <div className="message">
            Grupos, broadcasts e newsletters sao ignorados para reduzir carga. Contatos individuais
            @lid e @s.whatsapp.net continuam elegiveis para contatos, etiquetas e campanhas.
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Sincronizacao automatica"
        description="A sincronizacao de contatos e etiquetas ocorre automaticamente ao conectar o WhatsApp."
      >
        <div className="message">
          Use manutencao avancada apenas se o suporte pedir. Desconectar ou resetar limpa os dados
          operacionais do numero atual na interface.
        </div>
        {catalogMessage ? <div className="message success">{catalogMessage}</div> : null}
      </SectionCard>

      {error ? <div className="message error">{error}</div> : null}
      {qrRecoveryMessage ? <div className="message error">{qrRecoveryMessage}</div> : null}
      {!qrRecoveryMessage && !isTransientReconnect && session?.lastError && session.status !== "error" ? (
        <div className="message error">{session.lastError}</div>
      ) : null}

      {isTransientReconnect ? (
        <div className="message">
          Reconectando com a sessao atual. Nao e necessario resetar nem ler QR agora.
        </div>
      ) : session?.status === "connecting" ? (
        <div className="message">Aguardando QR Code. Isso pode levar alguns segundos.</div>
      ) : null}

      {!qrRecoveryMessage && session?.status === "error" && session.lastError ? (
        <div className="message error">{session.lastError}</div>
      ) : null}

      {session?.status === "qr" && session.qrCode ? (
        <SectionCard
          title="Leitura do QR Code"
          description="Escaneie com o WhatsApp do aparelho responsavel pela instancia."
        >
          <div className="qr-card">
            <img className="qr" src={session.qrCode} alt="QR Code do WhatsApp" />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Manutencao avancada"
        description="Use somente quando o QR nao aparece, a sessao esta corrompida ou a reconexao normal falhou."
        tone="danger"
      >
        <div className="danger-note">
          Resetar sessao remove a sessao local do Baileys, limpa dados operacionais e exige novo
          pareamento por QR. Nao use para quedas transitorias de conexao.
        </div>
        <div className="whatsapp-actions">
          <button
            className="button secondary"
            disabled={catalogBusy || session?.status === "qr"}
            type="button"
            onClick={() => void syncCatalogNow()}
          >
            {catalogBusy ? "Enviando..." : "Sincronizacao manual avancada"}
          </button>
          <button
            className="button danger"
            disabled={busy}
            type="button"
            onClick={() => void postAction("/api/whatsapp/reset-session")}
          >
            Resetar sessao
          </button>
        </div>
      </SectionCard>
    </section>
  );
}



