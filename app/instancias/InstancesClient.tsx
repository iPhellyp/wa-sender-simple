"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  getStoredActiveInstanceId,
  setStoredActiveInstanceId
} from "@/src/lib/client/active-instance";

type InstanceSummary = {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  roleLabel: string;
  status: string;
  sessionKey: string;
  isDefault: boolean;
  lastConnectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  updatedAt?: string | null;
  connectedPhone?: string | null;
  qrCode?: string | null;
  hasQrCode?: boolean;
  displayName: string | null;
  profilePictureUrl: string | null;
  hasSessionFiles?: boolean;
  sessionFilesCount?: number;
  hasCredsJson?: boolean;
  hasRegisteredSession?: boolean;
  hasMe?: boolean;
  hasMeId?: boolean;
  isPairingPartial?: boolean;
  isRecoverableSession?: boolean;
  isConnectingStale?: boolean;
  isQrStale?: boolean;
  canGenerateQr?: boolean;
  canResumeSession?: boolean;
  canSyncQuick?: boolean;
  canSyncHistory?: boolean;
  lastOpenAt?: string | null;
};

type InstancesResponse = {
  instances: InstanceSummary[];
  roles: Record<string, string>;
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function statusClass(status: string) {
  if (status === "connected") return "success";
  if (status === "error" || status === "disconnected") return "danger";
  if (status === "connecting" || status === "qr") return "info";
  return "warning";
}

function hasConfirmedSession(instance: InstanceSummary) {
  return Boolean(
    instance.hasRegisteredSession ||
    instance.hasMeId ||
    instance.connectedPhone ||
    instance.phone ||
    instance.status === "connected"
  );
}

function getConnectionActionLabel(instance: InstanceSummary) {
  if (instance.isPairingPartial || instance.isQrStale) {
    return "Gerar novo QR";
  }

  if (instance.isConnectingStale) {
    return instance.canResumeSession ? "Retomar sessao agora" : "Gerar QR";
  }

  const canResume = instance.canResumeSession ?? hasConfirmedSession(instance);
  return canResume ? "Retomar sessao" : "Gerar QR";
}

export function InstancesClient() {
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyInstanceId, setBusyInstanceId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activeInstanceId, setActiveInstanceId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("GENERAL");

  async function loadInstances() {
    const response = await fetch("/api/instances", { cache: "no-store" });
    const data = (await response.json()) as InstancesResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "Erro ao carregar instancias");
    }

    setInstances(data.instances);
    setRoles(data.roles);
    setActiveInstanceId((current) => {
      if (current && data.instances.some((instance) => instance.id === current)) {
        return current;
      }

      const nextInstanceId = data.instances[0]?.id ?? "";
      if (nextInstanceId) {
        setStoredActiveInstanceId(nextInstanceId);
      }
      return nextInstanceId;
    });
  }

  useEffect(() => {
    setActiveInstanceId(getStoredActiveInstanceId());
    void loadInstances().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
    });
  }, []);

  useEffect(() => {
    const shouldPoll = instances.some((instance) =>
      ["connecting", "qr"].includes(instance.status) || Boolean(instance.hasQrCode)
    );

    if (!shouldPoll) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadInstances().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
      });
    }, 3000);

    return () => window.clearInterval(interval);
  }, [instances]);

  function refreshSoon() {
    window.setTimeout(() => void loadInstances().catch(() => undefined), 1500);
    window.setTimeout(() => void loadInstances().catch(() => undefined), 5000);
  }

  async function createInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/instances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: normalizedName, role })
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao criar instancia");
      }

      setName("");
      setRole("GENERAL");
      setMessage("Instancia criada.");
      await loadInstances();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function patchInstance(instanceId: string, payload: { name?: string; role?: string; isDefault?: boolean }) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/instances/${instanceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao atualizar instancia");
      }

      setMessage("Instancia atualizada.");
      await loadInstances();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  function useInstance(instance: InstanceSummary) {
    setStoredActiveInstanceId(instance.id);
    setActiveInstanceId(instance.id);
    setMessage(`Instancia ativa alterada para ${instance.name}.`);
  }

  async function postAction(instance: InstanceSummary, action: "disconnect" | "reset") {
    if (action === "disconnect") {
      const confirmed = window.confirm(`Essa acao fecha apenas o socket da instancia ${instance.name}. A sessao salva nao sera apagada. Desconectar agora?`);

      if (!confirmed) {
        return;
      }
    }

    if (action === "reset") {
      const expected = instance.name;
      const typed = window.prompt(
        `Resetar sessao remove a sessao local e exige novo QR. Essa acao afeta apenas a instancia ${instance.name}.\nDigite ${expected} para confirmar.`
      );

      if (typed !== expected) {
        setError("Confirmacao invalida. Reset cancelado.");
        return;
      }
    }

    setBusy(true);
    setBusyInstanceId(instance.id);
    setError(null);
    setMessage(null);
    setCardErrors((current) => ({ ...current, [instance.id]: "" }));

    try {
      const response = await fetch(`/api/instances/${instance.id}/${action}`, {
        method: "POST"
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao executar acao");
      }

      setMessage(data.message ?? "Acao concluida.");
      if (action === "reset") {
        setInstances((current) =>
          current.map((item) =>
            item.id === instance.id
              ? {
                  ...item,
                  status: "disconnected",
                  qrCode: null,
                  hasQrCode: false,
                  connectedPhone: null,
                  phone: null,
                  hasSessionFiles: false,
                  sessionFilesCount: 0,
                  hasCredsJson: false,
                  hasRegisteredSession: false,
                  hasMe: false,
                  hasMeId: false,
                  isPairingPartial: false,
                  lastError: null
                }
              : item
          )
        );
      } else {
        await loadInstances();
      }
      refreshSoon();
    } catch (actionError) {
      const nextError = actionError instanceof Error ? actionError.message : "Erro inesperado";
      setCardErrors((current) => ({ ...current, [instance.id]: nextError }));
      setError(nextError);
    } finally {
      setBusy(false);
      setBusyInstanceId(null);
    }
  }

  async function deleteInstance(instance: InstanceSummary) {
    const typed = window.prompt(
      `Essa acao remove a instancia, sessao local e dados operacionais vinculados a ela. Nao afeta outras instancias.\nDigite o nome da instancia para confirmar: ${instance.name}`
    );

    if (typed !== instance.name) {
      setError("Confirmacao invalida. Delete cancelado.");
      return;
    }

    setBusy(true);
    setBusyInstanceId(instance.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/instances/${instance.id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          confirmationName: typed
        })
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        nextActiveInstanceId?: string | null;
      };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao deletar instancia");
      }

      const remainingInstances = instances.filter((item) => item.id !== instance.id);
      const nextActiveInstanceId =
        data.nextActiveInstanceId ?? remainingInstances.find((item) => item.id !== instance.id)?.id ?? "";

      setInstances((current) => current.filter((item) => item.id !== instance.id));

      if (activeInstanceId === instance.id) {
        setStoredActiveInstanceId(nextActiveInstanceId);
        setActiveInstanceId(nextActiveInstanceId);
      }

      setMessage(data.message ?? "Instancia deletada.");
      await loadInstances();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Erro inesperado");
    } finally {
      setBusy(false);
      setBusyInstanceId(null);
    }
  }

  async function postWhatsappAction(
    instance: InstanceSummary,
    action: "reconnect" | "sync-catalog" | "sync-catalog-full" | "sync-history"
  ) {
    const actionPath = action === "sync-catalog-full" ? "sync-catalog" : action;
    setBusy(true);
    setBusyInstanceId(instance.id);
    setBusyAction(action);
    setError(null);
    setMessage(null);
    setCardErrors((current) => ({ ...current, [instance.id]: "" }));

    try {
      const response = await fetch(`/api/whatsapp/${actionPath}?instanceId=${encodeURIComponent(instance.id)}`, {
        method: "POST",
        headers: action === "sync-catalog-full" || action === "sync-catalog"
          ? { "Content-Type": "application/json" }
          : undefined,
        body: action === "sync-catalog-full"
          ? JSON.stringify({ forceSnapshot: true })
          : action === "sync-catalog"
            ? JSON.stringify({ forceSnapshot: false })
            : undefined
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao executar acao");
      }

      setMessage(data.message ?? "Acao concluida.");
      if (action === "reconnect") {
        setInstances((current) =>
          current.map((item) =>
            item.id === instance.id
              ? {
                  ...item,
                  status: "connecting",
                  qrCode: null,
                  hasQrCode: false,
                  connectedPhone: hasConfirmedSession(item) && !item.isPairingPartial ? item.connectedPhone : null,
                  hasRegisteredSession: item.isPairingPartial ? false : item.hasRegisteredSession,
                  isPairingPartial: false,
                  lastError: null
                }
              : item
          )
        );
      } else {
        await loadInstances();
      }
      refreshSoon();
    } catch (actionError) {
      const nextError = actionError instanceof Error ? actionError.message : "Erro inesperado";
      const syncError = action.startsWith("sync")
        ? "Sincronizacao falhou, mas WhatsApp continua conectado."
        : nextError;
      setCardErrors((current) => ({ ...current, [instance.id]: syncError }));
      setError(nextError);
    } finally {
      setBusy(false);
      setBusyInstanceId(null);
      setBusyAction(null);
    }
  }

  return (
    <section className="page-shell">
      {error ? <div className="message error compact">{error}</div> : null}
      {message ? <div className="message compact">{message}</div> : null}

      <section className="data-card compact">
        <form className="filter-bar import-panel" onSubmit={(event) => void createInstance(event)}>
          <div className="field">
            <label htmlFor="instance-name">Nome</label>
            <input
              className="input"
              id="instance-name"
              name="name"
              placeholder="Ex: Vendas 2"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="instance-role">Funcao</label>
            <select
              className="select"
              id="instance-role"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {Object.entries(roles).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button className="button" disabled={busy || !name.trim()} type="submit">
            Criar instancia
          </button>
        </form>
      </section>

      {instances.length === 0 ? (
        <div className="empty-state compact">
          <strong>Nenhuma instancia cadastrada</strong>
          <span>Crie a primeira instancia para gerar QR e conectar um numero WhatsApp.</span>
          <button className="button" type="button" onClick={() => document.getElementById("instance-name")?.focus()}>
            Criar primeira instancia
          </button>
        </div>
      ) : null}

      <section className="instance-grid">
        {instances.map((instance) => (
          <article className={`instance-card ${activeInstanceId === instance.id ? "active" : ""}`} key={instance.id}>
            <div className="instance-card-header">
              <div>
                <div className="instance-title">
                  {instance.profilePictureUrl ? (
                    <img className="instance-photo" src={instance.profilePictureUrl} alt="" />
                  ) : (
                    <span className="instance-photo fallback">{instance.name.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span>
                    <strong>{instance.name}</strong>
                    <span>{instance.displayName ?? instance.connectedPhone ?? instance.phone ?? "Telefone nao conectado"}</span>
                  </span>
                </div>
              </div>
              <div className="button-row">
                {activeInstanceId === instance.id ? <span className="status-badge info">ativa</span> : null}
                <span className={`status-badge ${statusClass(instance.status)}`}>{instance.status}</span>
              </div>
            </div>

            <div className="meta-list compact">
              <div className="meta-row">
                <span>Funcao</span>
                <span>{instance.roleLabel}</span>
              </div>
              <div className="meta-row">
                <span>Ultima conexao</span>
                <span>{formatDate(instance.lastConnectedAt)}</span>
              </div>
              <div className="meta-row">
                <span>Ultima atividade</span>
                <span>{formatDate(instance.updatedAt ?? null)}</span>
              </div>
              <div className="meta-row">
                <span>Ultima sincronizacao</span>
                <span>{formatDate(instance.lastSyncAt)}</span>
              </div>
              <div className="meta-row">
                <span>Telefone conectado</span>
                <span>{instance.connectedPhone ?? instance.phone ?? "Nao conectado"}</span>
              </div>
              <div className="meta-row">
                <span>Sessao salva</span>
                <span>
                  {hasConfirmedSession(instance)
                    ? `Sim (${instance.sessionFilesCount ?? 0})`
                    : instance.isPairingPartial
                      ? "Parcial"
                      : "Nao"}
                </span>
              </div>
              <div className="meta-row">
                <span>QR aguardando</span>
                <span>{instance.hasQrCode ? "Sim" : "Nao"}</span>
              </div>
              <div className="meta-row">
                <span>Erro recente</span>
                <span>{instance.lastError ?? "-"}</span>
              </div>
            </div>

            {cardErrors[instance.id] ? (
              <div className="message error compact">{cardErrors[instance.id]}</div>
            ) : null}

            {instance.isPairingPartial ? (
              <div className="message warning compact">
                Pareamento incompleto. Gere um novo QR.
              </div>
            ) : null}

            {instance.isConnectingStale ? (
              <div className="message warning compact">
                Conexao nao concluiu. Tente novamente.
              </div>
            ) : null}

            {instance.isQrStale ? (
              <div className="message warning compact">
                QR expirou. Gere novo QR.
              </div>
            ) : null}

            {instance.qrCode ? (
              <div className="qr-card compact">
                <img className="qr" src={instance.qrCode} alt={`QR Code da instancia ${instance.name}`} />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor={`role-${instance.id}`}>Editar funcao</label>
              <select
                className="select"
                disabled={busy}
                id={`role-${instance.id}`}
                value={instance.role}
                onChange={(event) => void patchInstance(instance.id, { role: event.target.value })}
              >
                {Object.entries(roles).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div className="button-row">
              <button
                className="button compact-button"
                disabled={busy}
                type="button"
                onClick={() => useInstance(instance)}
              >
                Usar esta instancia
              </button>
              <button
                className="button compact-button"
                disabled={busy}
                type="button"
                onClick={() => void postWhatsappAction(instance, "reconnect")}
              >
                {busyInstanceId === instance.id
                  ? "Aguarde..."
                  : getConnectionActionLabel(instance)}
              </button>
              {instance.status === "connecting" && instance.canResumeSession ? (
                <button
                  className="button secondary compact-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void postWhatsappAction(instance, "reconnect")}
                >
                  Retomar sessao agora
                </button>
              ) : null}
              <button
                className="button secondary compact-button"
                disabled={busy || instance.canSyncQuick === false}
                type="button"
                onClick={() => void postWhatsappAction(instance, "sync-catalog")}
              >
                {busyInstanceId === instance.id && busyAction === "sync-catalog"
                  ? "Sincronizando..."
                  : "Sincronizar rapido"}
              </button>
              <button
                className="button secondary compact-button"
                disabled={busy || instance.canSyncQuick === false}
                type="button"
                onClick={() => void postWhatsappAction(instance, "sync-catalog-full")}
              >
                {busyInstanceId === instance.id && busyAction === "sync-catalog-full"
                  ? "Sincronizando..."
                  : "Sincronizacao completa"}
              </button>
              <button
                className="button secondary compact-button"
                disabled={busy || instance.canSyncHistory === false}
                type="button"
                onClick={() => void postWhatsappAction(instance, "sync-history")}
              >
                {busyInstanceId === instance.id && busyAction === "sync-history"
                  ? "Verificando..."
                  : "Verificar historico"}
              </button>
              <button
                className="button secondary compact-button"
                disabled={busy}
                type="button"
                onClick={() => void postAction(instance, "disconnect")}
              >
                Desconectar socket
              </button>
              <button
                className="button danger compact-button"
                disabled={busy}
                type="button"
                onClick={() => void postAction(instance, "reset")}
              >
                Resetar sessao
              </button>
              <button
                className="button danger compact-button"
                disabled={busy}
                type="button"
                onClick={() => void deleteInstance(instance)}
              >
                Deletar
              </button>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
