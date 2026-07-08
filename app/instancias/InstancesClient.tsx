"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

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

export function InstancesClient() {
  const [instances, setInstances] = useState<InstanceSummary[]>([]);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function loadInstances() {
    const response = await fetch("/api/instances", { cache: "no-store" });
    const data = (await response.json()) as InstancesResponse & { error?: string };

    if (!response.ok) {
      throw new Error(data.error ?? "Erro ao carregar instancias");
    }

    setInstances(data.instances);
    setRoles(data.roles);
  }

  useEffect(() => {
    void loadInstances().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
    });
  }, []);

  async function createInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "");
    const role = String(formData.get("role") ?? "GENERAL");

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/instances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name, role })
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao criar instancia");
      }

      event.currentTarget.reset();
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

  async function postAction(instanceId: string, action: "make-default" | "disconnect" | "reset") {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/api/instances/${instanceId}/${action}`, {
        method: "POST"
      });
      const data = (await response.json()) as { error?: string; message?: string };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Erro ao executar acao");
      }

      setMessage(data.message ?? "Acao concluida.");
      await loadInstances();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
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
            <input className="input" id="instance-name" name="name" placeholder="Ex: Vendas 2" />
          </div>
          <div className="field">
            <label htmlFor="instance-role">Funcao</label>
            <select className="select" id="instance-role" name="role" defaultValue="GENERAL">
              {Object.entries(roles).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button className="button" disabled={busy} type="submit">
            Criar instancia
          </button>
        </form>
      </section>

      <section className="instance-grid">
        {instances.map((instance) => (
          <article className="instance-card" key={instance.id}>
            <div className="instance-card-header">
              <div>
                <strong>{instance.name}</strong>
                <span>{instance.phone ?? "Telefone nao conectado"}</span>
              </div>
              <span className={`status-badge ${statusClass(instance.status)}`}>{instance.status}</span>
            </div>

            <div className="meta-list compact">
              <div className="meta-row">
                <span>Funcao</span>
                <span>{instance.roleLabel}</span>
              </div>
              <div className="meta-row">
                <span>Padrao</span>
                <span>{instance.isDefault ? "Sim" : "Nao"}</span>
              </div>
              <div className="meta-row">
                <span>Ultima conexao</span>
                <span>{formatDate(instance.lastConnectedAt)}</span>
              </div>
              <div className="meta-row">
                <span>Ultima sincronizacao</span>
                <span>{formatDate(instance.lastSyncAt)}</span>
              </div>
            </div>

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
              {!instance.isDefault ? (
                <button
                  className="button secondary compact-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void postAction(instance.id, "make-default")}
                >
                  Tornar padrao
                </button>
              ) : null}
              <Link className="button secondary compact-button" href={`/whatsapp?instanceId=${instance.id}`}>
                Abrir WhatsApp
              </Link>
              <button
                className="button secondary compact-button"
                disabled={busy}
                type="button"
                onClick={() => void postAction(instance.id, "disconnect")}
              >
                Desconectar
              </button>
              <button
                className="button danger compact-button"
                disabled={busy}
                type="button"
                onClick={() => void postAction(instance.id, "reset")}
              >
                Resetar
              </button>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
