"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ContactOption = {
  id: string;
  name: string;
  phoneNormalized: string;
  message: string | null;
  source: string;
  optedOut: boolean;
};

type LabelOption = {
  id: string;
  name: string;
  color: string | null;
};

type ChatPreview = {
  id: string;
  jid: string;
  name: string | null;
};

type ContactPreview = {
  id: string;
  name: string;
  phoneNormalized: string;
  source: string;
  optedOut: boolean;
};

type CampaignSummary = {
  id: string;
  name: string;
  targetMode: string;
  targetLabel?: LabelOption | null;
  defaultMessage: string | null;
  intervalMinutes: number;
  status: string;
  recipientCount: number;
  recipientStatusCounts: Record<string, number>;
};

type RecipientDetail = {
  id: string;
  jid: string | null;
  messageFinal: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  error: string | null;
  contact: ContactOption | null;
};

type LabelAudience = {
  total: number;
  eligible: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  jidTypeCounts: Record<string, number>;
  recipientsPreview: Array<{
    chatId: string;
    jid: string;
    name: string | null;
    jidType: string;
  }>;
};

type CampaignPrefillContext = {
  instanceId: string;
  labelId: string | null;
  labelName: string | null;
  chatIds: string[];
  chatPreview: ChatPreview[];
  contactIds: string[];
  contactPreview: ContactPreview[];
};

type AudienceMode = "label" | "catalog" | "contacts";

const steps = ["Publico", "Mensagem", "Seguranca", "Revisao"];

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
    sent: "enviada",
    failed: "falhou",
    pending: "pendente"
  };

  return labels[status] ?? status;
}

function audienceLabel(mode: AudienceMode) {
  if (mode === "label") return "Etiqueta WhatsApp";
  if (mode === "catalog") return "Contatos WhatsApp";
  return "Contatos importados";
}

function campaignAudienceLabel(mode: string) {
  if (mode === "label") return "Etiqueta WhatsApp";
  if (mode === "chatIds" || mode === "catalog") return "Contatos WhatsApp";
  if (mode === "contacts") return "Contatos importados";
  return mode;
}

function getPendingCount(counts: Record<string, number>) {
  return (counts.pending ?? 0) + (counts.scheduled ?? 0) + (counts.sending ?? 0);
}

export function CampaignsClient({
  prefillContext,
  labels
}: {
  prefillContext?: CampaignPrefillContext;
  labels: LabelOption[];
}) {
  const initialMode: AudienceMode = prefillContext?.labelId
    ? "label"
    : prefillContext?.chatIds.length
      ? "catalog"
      : "contacts";
  const [step, setStep] = useState(0);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(
    new Set(prefillContext?.contactPreview.map((contact) => contact.id) ?? [])
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientDetail[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>(initialMode);
  const [selectedLabelId, setSelectedLabelId] = useState(prefillContext?.labelId ?? labels[0]?.id ?? "");
  const [labelAudience, setLabelAudience] = useState<LabelAudience | null>(null);
  const [confirmedAudience, setConfirmedAudience] = useState(false);
  const [confirmedMessage, setConfirmedMessage] = useState(false);
  const [confirmedGroups, setConfirmedGroups] = useState(false);
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectableContacts = useMemo(
    () => contacts.filter((contact) => !contact.optedOut),
    [contacts]
  );
  const catalogChats = prefillContext?.chatPreview ?? [];
  const activeInstanceId = prefillContext?.instanceId ?? "";
  const prefilledContacts = prefillContext?.contactPreview ?? [];
  const removedPrefillContacts = Math.max(
    0,
    (prefillContext?.contactIds.length ?? 0) - prefilledContacts.length
  );
  const selectedLabel = labels.find((label) => label.id === selectedLabelId) ?? null;
  const audienceCount =
    audienceMode === "label"
      ? (labelAudience?.eligible ?? 0)
      : audienceMode === "catalog"
        ? catalogChats.length
        : selectedContacts.size;
  const securityConfirmed = confirmedAudience && confirmedMessage && confirmedGroups;
  const canCreate =
    Boolean(name.trim()) &&
    Boolean(message.trim()) &&
    intervalMinutes >= 1 &&
    audienceCount > 0 &&
    securityConfirmed;

  async function loadContacts() {
    const params = new URLSearchParams({
      optedOut: "false",
      pageSize: "100"
    });
    if (activeInstanceId) params.set("instanceId", activeInstanceId);
    const response = await fetch(`/api/contacts?${params.toString()}`, {
      cache: "no-store"
    });
    const data = (await response.json()) as { contacts: ContactOption[] };
    setContacts(data.contacts);
  }

  async function loadCampaigns() {
    const params = new URLSearchParams();
    if (activeInstanceId) params.set("instanceId", activeInstanceId);
    const response = await fetch(`/api/campaigns?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as { campaigns: CampaignSummary[] };
    setCampaigns(data.campaigns);
  }

  async function loadRecipients(campaignId: string) {
    const params = new URLSearchParams();
    if (activeInstanceId) params.set("instanceId", activeInstanceId);
    const response = await fetch(`/api/campaigns/${campaignId}/recipients?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as { recipients: RecipientDetail[] };
    setRecipients(data.recipients);
  }

  async function refresh() {
    setLoading(true);
    try {
      await Promise.all([loadContacts(), loadCampaigns()]);
      if (selectedCampaignId) await loadRecipients(selectedCampaignId);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
    });
  }, []);

  useEffect(() => {
    if (audienceMode !== "label" || !selectedLabelId) {
      setLabelAudience(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ limit: "6" });
        if (activeInstanceId) params.set("instanceId", activeInstanceId);
        const response = await fetch(`/api/etiquetas/${selectedLabelId}/audience?${params.toString()}`, {
          cache: "no-store"
        });
        const data = (await response.json()) as LabelAudience;
        if (!cancelled) setLabelAudience(data);
      } catch {
        if (!cancelled) setLabelAudience(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audienceMode, selectedLabelId]);

  function toggleContact(contactId: string) {
    setSelectedContacts((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  async function createCampaign() {
    setBusy(true);
    setError(null);
    setCreatedCampaignId(null);
    setCreatedMessage(null);

    try {
      const body = {
        name: name.trim(),
        defaultMessage: message.trim(),
        message: message.trim(),
        intervalMinutes
      };
      const response =
        audienceMode === "label"
          ? await fetch(`/api/etiquetas/${selectedLabelId}/campaigns`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                instanceId: activeInstanceId,
                name: body.name,
                message: body.message,
                intervalMinutes,
                startNow: false
              })
            })
          : await fetch("/api/campaigns", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: body.name,
                defaultMessage: body.defaultMessage,
                intervalMinutes,
                instanceId: activeInstanceId,
                contactIds: audienceMode === "contacts" ? Array.from(selectedContacts) : [],
                chatIds: audienceMode === "catalog" ? catalogChats.map((chat) => chat.id) : []
              })
            });
      const data = await response.json();

      if (!response.ok) throw new Error(String(data.error ?? "Erro ao criar campanha"));

      const campaignId = String(data.campaign?.id ?? data.id ?? "");
      setCreatedCampaignId(campaignId || null);
      setCreatedMessage(String(data.message ?? "Campanha criada em rascunho."));
      setSelectedCampaignId(campaignId || null);
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
      const params = new URLSearchParams();
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`/api/campaigns/${campaignId}/${action}?${params.toString()}`, {
        method: "POST"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Erro ao atualizar campanha"));
      await refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-shell">
      {error ? <div className="message error compact">{error}</div> : null}
      {prefilledContacts.length ? (
        <div className="message compact">
          Origem: {prefilledContacts.length} contato(s) importado(s) selecionado(s) em /contatos.
          Opt-out ja foi removido no preview.
        </div>
      ) : null}
      {removedPrefillContacts > 0 ? (
        <div className="message warning compact">
          {removedPrefillContacts} contato(s) da URL foram ignorados por opt-out, duplicidade ou ID
          invalido.
        </div>
      ) : null}
      {createdMessage ? (
        <div className="message compact success-row">
          <span>{createdMessage}</span>
          {createdCampaignId ? (
            <span className="button-row">
              <button
                className="button compact-button"
                disabled={busy}
                type="button"
                onClick={() => void runAction(createdCampaignId, "start")}
              >
                Iniciar agora
              </button>
              <Link
                className="button secondary compact-button"
                href={`/envios?campaign=${createdCampaignId}${
                  activeInstanceId ? `&instanceId=${activeInstanceId}` : ""
                }`}
              >
                Acompanhar em envios
              </Link>
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="wizard-layout">
        <div className="wizard-main">
          <aside className="wizard-sidebar">
            {steps.map((label, index) => (
              <button
                className={`wizard-step ${step === index ? "active" : ""}`}
                key={label}
                type="button"
                onClick={() => setStep(index)}
              >
                <span>{index + 1}</span>
                <strong>{label}</strong>
              </button>
            ))}
            <div className="wizard-note">
              <strong>{audienceCount}</strong>
              <span>destinatario(s) elegivel(is)</span>
            </div>
          </aside>

          <div className="wizard-content">
            {step === 0 ? (
              <div className="form-grid">
                <div className="audience-grid">
                  <button
                    className={`audience-card ${audienceMode === "label" ? "active" : ""}`}
                    type="button"
                    onClick={() => setAudienceMode("label")}
                  >
                    <strong>Etiqueta WhatsApp</strong>
                    <span>{labelAudience?.eligible ?? 0} elegiveis</span>
                  </button>
                  <button
                    className={`audience-card ${audienceMode === "catalog" ? "active" : ""}`}
                    disabled={catalogChats.length === 0}
                    type="button"
                    onClick={() => setAudienceMode("catalog")}
                  >
                    <strong>Contatos WhatsApp</strong>
                    <span>{catalogChats.length} selecionados</span>
                  </button>
                  <button
                    className={`audience-card ${audienceMode === "contacts" ? "active" : ""}`}
                    type="button"
                    onClick={() => setAudienceMode("contacts")}
                  >
                    <strong>Contatos importados</strong>
                    <span>{selectedContacts.size} selecionados</span>
                  </button>
                </div>

                {audienceMode === "label" ? (
                  <div className="data-card compact">
                    <div className="field">
                      <label htmlFor="campaign-label">Etiqueta</label>
                      <select
                        className="select"
                        id="campaign-label"
                        value={selectedLabelId}
                        onChange={(event) => setSelectedLabelId(event.target.value)}
                      >
                        {labels.map((label) => (
                          <option key={label.id} value={label.id}>
                            {label.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="row-meta">
                      <span>{selectedLabel?.name ?? "Etiqueta"}: {labelAudience?.eligible ?? 0} elegiveis</span>
                      <span>{labelAudience?.skipped ?? 0} ignorados</span>
                    </div>
                    <ul className="list-plain">
                      {(labelAudience?.recipientsPreview ?? []).map((recipient) => (
                        <li key={recipient.chatId}>
                          {recipient.name ?? recipient.jid} <span className="muted">({recipient.jidType})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {audienceMode === "catalog" ? (
                  <div className="data-card compact">
                    <strong>Contatos WhatsApp selecionados</strong>
                    <ul className="list-plain">
                      {catalogChats.length === 0 ? (
                        <li>Nenhum contato veio selecionado das conversas.</li>
                      ) : (
                        catalogChats.slice(0, 8).map((chat) => (
                          <li key={chat.id}>
                            {chat.name ?? chat.jid} <span className="muted">{chat.jid}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ) : null}

                {audienceMode === "contacts" ? (
                  <div className="data-card compact">
                    {prefilledContacts.length ? (
                      <div className="message compact">
                        Preview selecionado:{" "}
                        {prefilledContacts.slice(0, 6).map((contact) => contact.name).join(", ")}
                        {prefilledContacts.length > 6 ? "..." : ""}
                      </div>
                    ) : null}
                    <div className="button-row">
                      <button
                        className="button secondary compact-button"
                        type="button"
                        onClick={() => setSelectedContacts(new Set(selectableContacts.map((contact) => contact.id)))}
                      >
                        Selecionar todos
                      </button>
                      <button
                        className="button secondary compact-button"
                        type="button"
                        onClick={() => setSelectedContacts(new Set())}
                      >
                        Limpar
                      </button>
                    </div>
                    <div className="contact-picker compact">
                      {selectableContacts.map((contact) => (
                        <label className="contact-option" key={contact.id}>
                          <input
                            checked={selectedContacts.has(contact.id)}
                            type="checkbox"
                            onChange={() => toggleContact(contact.id)}
                          />
                          <span>
                            <strong>{contact.name}</strong>
                            <br />
                            <span className="muted">
                              {contact.phoneNormalized} | {contact.source}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="campaign-name">Nome da campanha</label>
                  <input
                    className="input"
                    id="campaign-name"
                    maxLength={120}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="campaign-message">Mensagem</label>
                  <textarea
                    className="textarea tall"
                    id="campaign-message"
                    maxLength={4000}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <span className="muted">{message.length}/4000 caracteres</span>
                </div>
                <div className="field">
                  <label htmlFor="campaign-interval">Intervalo entre envios em minutos</label>
                  <input
                    className="input"
                    id="campaign-interval"
                    min="1"
                    type="number"
                    value={intervalMinutes}
                    onChange={(event) => setIntervalMinutes(Number(event.target.value))}
                  />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="form-grid">
                <label className="check-card">
                  <input
                    checked={confirmedAudience}
                    type="checkbox"
                    onChange={(event) => setConfirmedAudience(event.target.checked)}
                  />
                  <span>Conferi o publico selecionado.</span>
                </label>
                <label className="check-card">
                  <input
                    checked={confirmedMessage}
                    type="checkbox"
                    onChange={(event) => setConfirmedMessage(event.target.checked)}
                  />
                  <span>Conferi a mensagem e o intervalo.</span>
                </label>
                <label className="check-card">
                  <input
                    checked={confirmedGroups}
                    type="checkbox"
                    onChange={(event) => setConfirmedGroups(event.target.checked)}
                  />
                  <span>Entendo que grupos sao ignorados.</span>
                </label>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="review-grid">
                <div className="data-card compact">
                  <strong>Resumo</strong>
                  <ul className="list-plain">
                    <li>Nome: {name || "nao informado"}</li>
                    <li>Publico: {audienceLabel(audienceMode)}</li>
                    <li>Destinatarios: {audienceCount}</li>
                    <li>Intervalo: {intervalMinutes || 0} minuto(s)</li>
                    <li>Mensagem: {message.trim() ? "preenchida" : "pendente"}</li>
                    <li>Seguranca: {securityConfirmed ? "confirmada" : "pendente"}</li>
                  </ul>
                </div>
                <div className="data-card compact">
                  <strong>Criar rascunho</strong>
                  <p className="muted">O envio so comeca quando voce iniciar a campanha.</p>
                  <button
                    className="button wide-action"
                    disabled={busy || !canCreate}
                    type="button"
                    onClick={() => void createCampaign()}
                  >
                    Criar campanha em rascunho
                  </button>
                </div>
              </div>
            ) : null}

            <div className="wizard-nav">
              <button
                className="button secondary"
                disabled={step === 0}
                type="button"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
              >
                Voltar
              </button>
              <button
                className="button"
                disabled={step === steps.length - 1}
                type="button"
                onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
              >
                Proximo
              </button>
            </div>
          </div>
        </div>

        <aside className="preview-panel">
          <div className="preview-panel-header">
            <strong>Preview</strong>
            <span className={`status-badge ${canCreate ? "success" : "warning"}`}>
              {canCreate ? "pronto" : "pendente"}
            </span>
          </div>
          <div className="meta-list compact">
            <div className="meta-row">
              <span>Publico</span>
              <span>{audienceLabel(audienceMode)}</span>
            </div>
            <div className="meta-row">
              <span>Elegiveis</span>
              <span>{audienceCount}</span>
            </div>
            <div className="meta-row">
              <span>Intervalo</span>
              <span>{intervalMinutes || 0} min</span>
            </div>
          </div>
          <div className="message-preview">
            {message.trim() ? message : "Digite a mensagem para visualizar o envio."}
          </div>
        </aside>
      </section>

      <section className="data-card">
        <div className="table-toolbar">
          <div>
            <strong>Campanhas recentes</strong>
            <span className="muted">{campaigns.length} campanha(s)</span>
          </div>
          <button className="button secondary compact-button" type="button" onClick={() => void refresh()}>
            Atualizar
          </button>
        </div>
        {loading ? (
          <div className="empty-state compact">Carregando campanhas...</div>
        ) : campaigns.length === 0 ? (
          <div className="empty-state compact">
            <strong>Nenhuma campanha criada</strong>
            <span>Crie um rascunho para iniciar os envios.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Campanha</th>
                  <th>Publico</th>
                  <th>Status</th>
                  <th>Destinatarios</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.name}</td>
                    <td>{campaign.targetLabel?.name ?? campaignAudienceLabel(campaign.targetMode)}</td>
                    <td>
                      <span className={`status-badge ${statusClass(campaign.status)}`}>
                        {statusLabel(campaign.status)}
                      </span>
                    </td>
                    <td>
                      {campaign.recipientCount} total | {campaign.recipientStatusCounts.sent ?? 0} enviados |{" "}
                      {campaign.recipientStatusCounts.failed ?? 0} falhas |{" "}
                      {getPendingCount(campaign.recipientStatusCounts)} pendentes
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button secondary compact-button"
                          type="button"
                          onClick={() => {
                            setSelectedCampaignId(campaign.id);
                            void loadRecipients(campaign.id);
                          }}
                        >
                          Ver
                        </button>
                        <button
                          className="button secondary compact-button"
                          disabled={busy || !["draft", "paused"].includes(campaign.status)}
                          type="button"
                          onClick={() => void runAction(campaign.id, campaign.status === "paused" ? "resume" : "start")}
                        >
                          {campaign.status === "paused" ? "Retomar" : "Iniciar"}
                        </button>
                        <button
                          className="button danger compact-button"
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

        {selectedCampaignId ? (
          <div className="detail-panel compact">
            <div className="table-toolbar">
              <strong>Destinatarios da campanha</strong>
              <span className="muted">{recipients.length} exibido(s)</span>
            </div>
            {recipients.length === 0 ? (
              <div className="empty-state compact">Nenhum destinatario.</div>
            ) : (
              <div className="campaign-list compact">
                {recipients.slice(0, 12).map((recipient) => (
                  <div className="recipient-row" key={recipient.id}>
                    <div>
                      <strong>{recipient.contact?.name ?? recipient.jid ?? recipient.id}</strong>
                      <span className="muted">{recipient.contact?.phoneNormalized ?? recipient.jid}</span>
                    </div>
                    <span className={`status-badge ${statusClass(recipient.status)}`}>
                      {statusLabel(recipient.status)}
                    </span>
                    {recipient.error ? <span className="send-error">{recipient.error}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>
    </section>
  );
}
