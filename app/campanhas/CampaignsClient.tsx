"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ContactOption = {
  id: string;
  name: string;
  phoneNormalized: string;
  message: string | null;
  source: string;
  optedOut: boolean;
};

type CampaignSummary = {
  id: string;
  name: string;
  defaultMessage: string | null;
  intervalMinutes: number;
  status: string;
  recipientCount: number;
  recipientStatusCounts: Record<string, number>;
};

type RecipientDetail = {
  id: string;
  messageFinal: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  error: string | null;
  contact: ContactOption;
};

type CampaignPrefillContext = {
  labelId: string | null;
  labelName: string | null;
  chatIds: string[];
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

export function CampaignsClient({
  prefillContext
}: {
  prefillContext?: CampaignPrefillContext;
}) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableContacts = useMemo(
    () => contacts.filter((contact) => !contact.optedOut),
    [contacts]
  );

  async function loadContacts() {
    const response = await fetch("/api/contacts?optedOut=false", { cache: "no-store" });
    const data = (await response.json()) as {
      contacts: ContactOption[];
    };
    setContacts(data.contacts);
  }

  async function loadCampaigns() {
    const response = await fetch("/api/campaigns", { cache: "no-store" });
    const data = (await response.json()) as {
      campaigns: CampaignSummary[];
    };
    setCampaigns(data.campaigns);
  }

  async function loadRecipients(campaignId: string) {
    const response = await fetch(`/api/campaigns/${campaignId}/recipients`, { cache: "no-store" });
    const data = (await response.json()) as {
      recipients: RecipientDetail[];
    };
    setRecipients(data.recipients);
  }

  async function refresh() {
    setLoading(true);
    await Promise.all([loadContacts(), loadCampaigns()]);
    if (selectedCampaignId) {
      await loadRecipients(selectedCampaignId);
    }
    setLoading(false);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name: String(formData.get("name") ?? ""),
          defaultMessage: String(formData.get("defaultMessage") ?? ""),
          intervalMinutes: Number(formData.get("intervalMinutes") ?? 0),
          contactIds: Array.from(selectedContacts)
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(String(data.error ?? "Erro ao criar campanha"));
      }

      form.reset();
      setSelectedContacts(new Set());
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(campaignId: string, action: "start" | "pause" | "resume" | "cancel") {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/${action}`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(String(data.error ?? "Erro ao atualizar campanha"));
      }

      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  function toggleContact(contactId: string) {
    setSelectedContacts((current) => {
      const next = new Set(current);

      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }

      return next;
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="grid">
      {prefillContext?.labelId ? (
        <div className="message">
          Origem: segmento{" "}
          <strong>{prefillContext.labelName ?? prefillContext.labelId}</strong>. Para criar campanha
          por etiqueta com público X1 resolvido, use o fluxo dedicado da etiqueta.{" "}
          <Link className="button secondary compact-button" href={`/etiquetas/${prefillContext.labelId}/enviar`}>
            Abrir criação por etiqueta
          </Link>
        </div>
      ) : null}

      {prefillContext?.chatIds.length ? (
        <div className="message">
          Origem: {prefillContext.chatIds.length} contato(s) selecionado(s) do Catálogo X1. Esta
          tela reconhece os IDs recebidos por query; a criação manual atual ainda usa contatos
          importados da lista de contatos.
        </div>
      ) : null}

      <section className="grid two-column">
      <div className="grid">
        <div className="card">
          <form className="form-grid" onSubmit={(event) => void handleCreate(event)}>
            <div className="field">
              <label htmlFor="name">Nome</label>
              <input className="input" id="name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="defaultMessage">Mensagem padrao opcional</label>
              <textarea className="textarea" id="defaultMessage" name="defaultMessage" />
            </div>
            <div className="field">
              <label htmlFor="intervalMinutes">Intervalo em minutos</label>
              <input
                className="input"
                id="intervalMinutes"
                min="1"
                name="intervalMinutes"
                required
                type="number"
              />
            </div>

            <div className="field">
              <label>Contatos</label>
              <div className="button-row">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setSelectedContacts(new Set(selectableContacts.map((contact) => contact.id)))}
                >
                  Selecionar visiveis
                </button>
                <button className="button secondary" type="button" onClick={() => setSelectedContacts(new Set())}>
                  Limpar
                </button>
              </div>
              <div className="contact-picker">
                {selectableContacts.length === 0 ? (
                  <div className="muted" style={{ padding: 12 }}>
                    Nenhum contato disponivel.
                  </div>
                ) : (
                  selectableContacts.map((contact) => (
                    <label className="contact-option" key={contact.id}>
                      <input
                        checked={selectedContacts.has(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        type="checkbox"
                      />
                      <span>
                        <strong>{contact.name}</strong>
                        <br />
                        <span className="muted">
                          {contact.phoneNormalized} | {contact.source}
                        </span>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>

            {error ? <div className="message error">{error}</div> : null}

            <button className="button" disabled={busy} type="submit">
              Criar campanha
            </button>
          </form>
        </div>

        <div className="card">
          {loading ? (
            <div>Carregando...</div>
          ) : campaigns.length === 0 ? (
            <div className="muted">Nenhuma campanha criada.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Campanha</th>
                    <th>Status</th>
                    <th>Destinatarios</th>
                    <th>Intervalo</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>{campaign.name}</td>
                      <td>
                        <span className={`badge ${statusClass(campaign.status)}`}>{campaign.status}</span>
                      </td>
                      <td>{campaign.recipientCount}</td>
                      <td>{campaign.intervalMinutes} min</td>
                      <td>
                        <div className="button-row">
                          <button
                            className="button secondary"
                            disabled={busy}
                            type="button"
                            onClick={() => {
                              setSelectedCampaignId(campaign.id);
                              void loadRecipients(campaign.id);
                            }}
                          >
                            Ver
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy || !["draft", "paused"].includes(campaign.status)}
                            type="button"
                            onClick={() => void runAction(campaign.id, campaign.status === "paused" ? "resume" : "start")}
                          >
                            {campaign.status === "paused" ? "Retomar" : "Iniciar"}
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy || campaign.status !== "running"}
                            type="button"
                            onClick={() => void runAction(campaign.id, "pause")}
                          >
                            Pausar
                          </button>
                          <button
                            className="button danger"
                            disabled={busy || ["completed", "canceled"].includes(campaign.status)}
                            type="button"
                            onClick={() => void runAction(campaign.id, "cancel")}
                          >
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <aside className="card">
        <h2 style={{ fontSize: 18, marginTop: 0 }}>Destinatarios</h2>
        {selectedCampaignId ? (
          recipients.length === 0 ? (
            <div className="muted">Nenhum destinatario.</div>
          ) : (
            <div className="grid">
              {recipients.map((recipient) => (
                <div key={recipient.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                  <div className="button-row" style={{ justifyContent: "space-between" }}>
                    <strong>{recipient.contact.name}</strong>
                    <span className={`badge ${statusClass(recipient.status)}`}>{recipient.status}</span>
                  </div>
                  <div className="muted">{recipient.contact.phoneNormalized}</div>
                  {recipient.error ? <div className="message error">{recipient.error}</div> : null}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="muted">Selecione uma campanha.</div>
        )}
      </aside>
      </section>
    </section>
  );
}
