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
  labelId: string | null;
  labelName: string | null;
  chatIds: string[];
  chatPreview: ChatPreview[];
};

type AudienceMode = "label" | "catalog" | "contacts";

const steps = ["Dados", "Publico", "Mensagem", "Seguranca", "Revisao"];

function statusClass(status: string) {
  if (["sent", "completed", "connected"].includes(status)) return "success";
  if (["failed", "canceled", "error"].includes(status)) return "danger";
  if (["running", "sending", "scheduled"].includes(status)) return "info";
  return "warning";
}

function audienceLabel(mode: AudienceMode) {
  if (mode === "label") return "Etiqueta";
  if (mode === "catalog") return "Contatos selecionados do Catalogo X1";
  return "Contatos importados";
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
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientDetail[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [audienceMode, setAudienceMode] = useState<AudienceMode>(initialMode);
  const [selectedLabelId, setSelectedLabelId] = useState(prefillContext?.labelId ?? labels[0]?.id ?? "");
  const [labelAudience, setLabelAudience] = useState<LabelAudience | null>(null);
  const [confirmed, setConfirmed] = useState(false);
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
  const selectedLabel = labels.find((label) => label.id === selectedLabelId) ?? null;
  const audienceCount =
    audienceMode === "label"
      ? (labelAudience?.eligible ?? 0)
      : audienceMode === "catalog"
        ? catalogChats.length
        : selectedContacts.size;
  const canCreate = Boolean(name.trim()) && Boolean(message.trim()) && intervalMinutes >= 1 && audienceCount > 0 && confirmed;

  async function loadContacts() {
    const response = await fetch("/api/contacts?optedOut=false", { cache: "no-store" });
    const data = (await response.json()) as { contacts: ContactOption[] };
    setContacts(data.contacts);
  }

  async function loadCampaigns() {
    const response = await fetch("/api/campaigns", { cache: "no-store" });
    const data = (await response.json()) as { campaigns: CampaignSummary[] };
    setCampaigns(data.campaigns);
  }

  async function loadRecipients(campaignId: string) {
    const response = await fetch(`/api/campaigns/${campaignId}/recipients`, { cache: "no-store" });
    const data = (await response.json()) as { recipients: RecipientDetail[] };
    setRecipients(data.recipients);
  }

  async function refresh() {
    setLoading(true);
    await Promise.all([loadContacts(), loadCampaigns()]);
    if (selectedCampaignId) await loadRecipients(selectedCampaignId);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (audienceMode !== "label" || !selectedLabelId) {
      setLabelAudience(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/etiquetas/${selectedLabelId}/audience?limit=6`, {
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
      const response = await fetch(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
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
    <section className="grid">
      <div className="page-header">
        <div>
          <span className="eyebrow">Campanhas WhatsApp</span>
          <h1>Crie envios por etiqueta, catalogo X1 ou contatos importados</h1>
          <p>
            Fluxo simples: escolha o publico, revise a mensagem e crie a campanha em rascunho
            antes de iniciar.
          </p>
        </div>
        <Link className="button secondary" href="/envios">
          Ver historico de envios
        </Link>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {createdMessage ? (
        <div className="message">
          {createdMessage}{" "}
          {createdCampaignId ? (
            <>
              <button
                className="button compact-button"
                disabled={busy}
                type="button"
                onClick={() => void runAction(createdCampaignId, "start")}
              >
                Iniciar agora
              </button>{" "}
              <Link className="button secondary compact-button" href={`/envios?campaignId=${createdCampaignId}`}>
                Acompanhar em envios
              </Link>
            </>
          ) : null}
        </div>
      ) : null}

      <section className="section-card">
        <div className="toolbar">
          <div className="button-row" aria-label="Etapas da campanha">
            {steps.map((label, index) => (
              <button
                className={`button ${step === index ? "" : "secondary"} compact-button`}
                key={label}
                type="button"
                onClick={() => setStep(index)}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>
          <span className="muted">{audienceCount} destinatario(s) elegivel(is)</span>
        </div>

        {step === 0 ? (
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

        {step === 1 ? (
          <div className="grid two-column">
            <div className="field">
              <label>Publico</label>
              <div className="button-row">
                <button
                  className={`button ${audienceMode === "label" ? "" : "secondary"}`}
                  type="button"
                  onClick={() => setAudienceMode("label")}
                >
                  Etiqueta
                </button>
                <button
                  className={`button ${audienceMode === "catalog" ? "" : "secondary"}`}
                  disabled={catalogChats.length === 0}
                  type="button"
                  onClick={() => setAudienceMode("catalog")}
                >
                  Catalogo X1
                </button>
                <button
                  className={`button ${audienceMode === "contacts" ? "" : "secondary"}`}
                  type="button"
                  onClick={() => setAudienceMode("contacts")}
                >
                  Importados
                </button>
              </div>
              <p className="muted">Grupos continuam excluidos. @lid e @s.whatsapp.net seguem elegiveis.</p>
            </div>

            <div className="card">
              <strong>{audienceLabel(audienceMode)}</strong>
              {audienceMode === "label" ? (
                <div className="form-grid">
                  <select
                    className="input"
                    value={selectedLabelId}
                    onChange={(event) => setSelectedLabelId(event.target.value)}
                  >
                    {labels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                  <div className="muted">
                    {selectedLabel?.name ?? "Etiqueta"}: {labelAudience?.eligible ?? 0} elegiveis,
                    {` ${labelAudience?.skipped ?? 0}`} ignorados.
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
                <ul className="list-plain">
                  {catalogChats.length === 0 ? (
                    <li>Nenhum contato veio selecionado do Catalogo X1.</li>
                  ) : (
                    catalogChats.slice(0, 8).map((chat) => (
                      <li key={chat.id}>
                        {chat.name ?? chat.jid} <span className="muted">{chat.jid}</span>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}

              {audienceMode === "contacts" ? (
                <div className="form-grid">
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
                  <div className="contact-picker">
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
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid two-column">
            <div className="field">
              <label htmlFor="campaign-message">Mensagem</label>
              <textarea
                className="textarea"
                id="campaign-message"
                maxLength={4000}
                rows={10}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <span className="muted">{message.length}/4000 caracteres</span>
            </div>
            <div className="card">
              <strong>Preview</strong>
              <p style={{ whiteSpace: "pre-wrap" }}>{message || "Digite a mensagem da campanha."}</p>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid">
            <div className="message warning">
              A campanha sera criada em rascunho. O envio so comeca quando voce clicar em iniciar.
              Grupos sao ignorados e opt-out continua respeitado nas rotas existentes.
            </div>
            <label className="contact-option">
              <input
                checked={confirmed}
                type="checkbox"
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>Confirmei publico, mensagem e intervalo antes de criar a campanha.</span>
            </label>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid two-column">
            <div className="card">
              <strong>Resumo</strong>
              <ul className="list-plain">
                <li>Nome: {name || "nao informado"}</li>
                <li>Publico: {audienceLabel(audienceMode)}</li>
                <li>Destinatarios: {audienceCount}</li>
                <li>Intervalo: {intervalMinutes || 0} minuto(s)</li>
                <li>Mensagem: {message.trim() ? "preenchida" : "pendente"}</li>
              </ul>
            </div>
            <div className="card">
              <strong>Acoes</strong>
              <p className="muted">Crie a campanha em rascunho e acompanhe o status em /envios.</p>
              <button className="button" disabled={busy || !canCreate} type="button" onClick={() => void createCampaign()}>
                Criar campanha em rascunho
              </button>
            </div>
          </div>
        ) : null}

        <div className="button-row">
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
      </section>

      <section className="grid two-column">
        <div className="section-card">
          <div className="toolbar">
            <strong>Campanhas recentes</strong>
            <button className="button secondary compact-button" type="button" onClick={() => void refresh()}>
              Atualizar
            </button>
          </div>
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
                      <td>{campaign.targetLabel?.name ?? campaign.targetMode}</td>
                      <td>
                        <span className={`badge ${statusClass(campaign.status)}`}>{campaign.status}</span>
                      </td>
                      <td>
                        {campaign.recipientCount} | sent {campaign.recipientStatusCounts.sent ?? 0} | fail{" "}
                        {campaign.recipientStatusCounts.failed ?? 0}
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
        </div>

        <aside className="section-card">
          <strong>Destinatarios da campanha</strong>
          {selectedCampaignId ? (
            recipients.length === 0 ? (
              <div className="muted">Nenhum destinatario.</div>
            ) : (
              <div className="grid">
                {recipients.slice(0, 20).map((recipient) => (
                  <div key={recipient.id} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                    <div className="button-row" style={{ justifyContent: "space-between" }}>
                      <strong>{recipient.contact?.name ?? recipient.jid ?? recipient.id}</strong>
                      <span className={`badge ${statusClass(recipient.status)}`}>{recipient.status}</span>
                    </div>
                    <div className="muted">{recipient.contact?.phoneNormalized ?? recipient.jid}</div>
                    {recipient.error ? <div className="message error">{recipient.error}</div> : null}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="muted">Selecione uma campanha para ver sent, failed e pending.</div>
          )}
        </aside>
      </section>
    </section>
  );
}
