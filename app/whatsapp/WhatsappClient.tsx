"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink } from "@/app/components/ui/ButtonLink";
import { SectionCard } from "@/app/components/ui/SectionCard";
import { StatusBadge, statusToneFromValue } from "@/app/components/ui/StatusBadge";
import {
  getStoredActiveInstanceId,
  setStoredActiveInstanceId
} from "@/src/lib/client/active-instance";

type WhatsappSession = {
  id: string;
  status: string;
  qrCode: string | null;
  hasQrCode: boolean;
  hasQr?: boolean;
  hasSessionFiles?: boolean;
  sessionFilesCount?: number;
  hasCredsJson?: boolean;
  connectedPhone: string | null;
  lastError: string | null;
  updatedAt: string;
  instanceId?: string;
  instanceName?: string;
  instanceRole?: string;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  lastOpenAt?: string | null;
  lastConnectedAt?: string | null;
  lastSyncAt?: string | null;
  latestMessageAt?: string | null;
  isRecoverableSession?: boolean;
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
  const activeInstanceId = searchParams.get("instanceId") ?? getStoredActiveInstanceId();
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
      if (data.instanceId) {
        setStoredActiveInstanceId(data.instanceId);
      }
      setError(null);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function postAction(path: string, options: { dangerous?: "disconnect" | "reset" } = {}) {
    const instanceName = session?.instanceName ?? session?.instanceId ?? activeInstanceId;
    const instanceId = session?.instanceId ?? activeInstanceId;

    if (!instanceId) {
      setError("Instancia ativa ausente. Abra /instancias e escolha uma instancia.");
      return;
    }

    if (options.dangerous === "disconnect") {
      const confirmed = window.confirm(`Essa acao afeta apenas a instancia ${instanceName}. Desconectar agora?`);

      if (!confirmed) {
        return;
      }
    }

    if (options.dangerous === "reset") {
      const expected = instanceName;
      const typed = window.prompt(
        `Resetar sessao remove a sessao local e exige novo QR. Essa acao afeta apenas a instancia ${instanceName}.\nDigite ${expected} para confirmar.`
      );

      if (typed !== expected) {
        setError("Confirmacao invalida. Reset cancelado.");
        return;
      }
    }

    setBusy(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("instanceId", instanceId);
      const response = await fetch(`${path}?${params.toString()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ instanceId })
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

  if (error === "Crie uma instancia para conectar o WhatsApp") {
    return (
      <div className="empty-state compact">
        <strong>Crie uma instancia para conectar o WhatsApp</strong>
        <span>Depois de criar a primeira instancia, abra esta tela para gerar o QR.</span>
        <ButtonLink href="/instancias">Criar primeira instancia</ButtonLink>
      </div>
    );
  }

  const qrRecoveryMessage = getQrRecoveryMessage(session);
  const isTransientReconnect = isTransientReconnectStatus(session);
  const reconnectDisabled = busy || (session?.status === "qr" && session.hasQrCode);
  const status = session?.status ?? "disconnected";
  const statusTone = statusToneFromValue(status);
  const hasSessionFiles = Boolean(session?.hasSessionFiles || session?.hasCredsJson);
  const canResumeSession = Boolean(session?.isRecoverableSession || (hasSessionFiles && status !== "connected" && status !== "qr"));
  const primaryConnectionLabel = canResumeSession ? "Retomar sessao" : "Gerar QR";

  return (
    <section className="whatsapp-page">
      <div className="whatsapp-health-grid">
        <SectionCard
          title="Saude da conexao"
          description="Conecte e gerencie o WhatsApp desta instancia."
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
                <span>Perfil WhatsApp</span>
                <span className="instance-title">
                  {session?.profilePictureUrl ? (
                    <img className="instance-photo" src={session.profilePictureUrl} alt="" />
                  ) : (
                    <span className="instance-photo fallback">
                      {(session?.displayName ?? session?.instanceName ?? "W").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span>{session?.displayName ?? "Nome nao disponivel"}</span>
                </span>
              </div>
              <div className="meta-row">
                <span>Instancia ativa</span>
                <span>{session?.instanceName ?? session?.instanceId ?? "Instancia ativa"}</span>
              </div>
              <div className="meta-row">
                <span>Funcao</span>
                <span>{session?.instanceRole ?? "-"}</span>
              </div>
              <div className="meta-row">
                <span>Telefone conectado</span>
                <span>{session?.connectedPhone ?? "Nao conectado"}</span>
              </div>
              <div className="meta-row">
                <span>Ultima conexao</span>
                <span>{formatDateTime(session?.lastConnectedAt)}</span>
              </div>
              <div className="meta-row">
                <span>Ultima abertura do socket</span>
                <span>{formatDateTime(session?.lastOpenAt)}</span>
              </div>
              <div className="meta-row">
                <span>Ultima sincronizacao</span>
                <span>{formatDateTime(session?.lastSyncAt)}</span>
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
              <div className="meta-row">
                <span>Sessao salva</span>
                <span>{hasSessionFiles ? `Sim (${session?.sessionFilesCount ?? 0} arquivos)` : "Nao"}</span>
              </div>
            </div>

            <div className="whatsapp-actions">
              <button
                className="button"
                disabled={reconnectDisabled}
                type="button"
                onClick={() => void postAction("/api/whatsapp/reconnect")}
              >
                {primaryConnectionLabel}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                type="button"
                onClick={() => void postAction("/api/whatsapp/disconnect", { dangerous: "disconnect" })}
              >
                Desconectar socket
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Operacao" description="Use esta tela para gerar QR, acompanhar status, sincronizar e gerenciar a sessao.">
          <div className="message">
            {hasSessionFiles
              ? "Sessao local encontrada. Use Retomar sessao antes de resetar ou pedir novo QR."
              : "Sem sessao local. Use Gerar QR para parear esta instancia."}
          </div>
          <ButtonLink href={`/instancias${activeInstanceId ? `?instanceId=${activeInstanceId}` : ""}`}>
            Ver instancias
          </ButtonLink>
        </SectionCard>
      </div>

      <SectionCard
        title="Sincronizacao automatica"
        description="A sincronizacao de contatos e etiquetas ocorre automaticamente ao conectar o WhatsApp."
      >
        <div className="message">
          Use manutencao avancada apenas se o suporte pedir. Desconectar fecha o socket sem apagar a
          sessao. Resetar remove a sessao local e pode exigir QR novo.
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
      ) : canResumeSession ? (
        <div className="message">
          Sessao salva encontrada. Clique em Retomar sessao para reabrir o socket sem QR.
        </div>
      ) : session?.status === "connecting" ? (
        <div className="message">Aguardando QR Code. Isso pode levar alguns segundos.</div>
      ) : null}

      {session && session.status !== "connected" && session.status !== "qr" && !session.qrCode ? (
        <div className="message">
          {hasSessionFiles
            ? "QR nao sera gerado automaticamente enquanto existir sessao salva."
            : "QR ainda nao gerado. Clique em Gerar QR e aguarde alguns segundos."}
        </div>
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
          pareamento por QR. A acao afeta apenas esta instancia.
        </div>
        <div className="whatsapp-actions">
          <button
            className="button secondary"
            disabled={catalogBusy || session?.status === "qr"}
            type="button"
            onClick={() => void syncCatalogNow()}
          >
            {catalogBusy ? "Enviando..." : "Sincronizar esta instancia"}
          </button>
          <button
            className="button danger"
            disabled={busy}
            type="button"
            onClick={() => void postAction("/api/whatsapp/reset-session", { dangerous: "reset" })}
          >
            Resetar esta instancia
          </button>
        </div>
      </SectionCard>
    </section>
  );
}



