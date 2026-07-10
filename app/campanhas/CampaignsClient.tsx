"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderCampaignMessage } from "@/src/lib/campaigns/message-template";

type ContactOption = {
  id: string;
  name: string;
  phoneRaw?: string;
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
  displayName?: string;
  identityLabel?: string;
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
  scheduledAt: string | null;
  hasMedia: boolean;
  mediaKind: string | null;
  mediaOriginalName: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
  lastError: string | null;
  recipientCount: number;
  recipientStatusCounts: Record<string, number>;
};

type RecipientDetail = {
  id: string;
  jid: string | null;
  displayName: string;
  displayPhone: string | null;
  displaySubtitle: string;
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
    displayName?: string;
    displayPhone?: string | null;
    displaySubtitle?: string | null;
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
type DelayMode = "fixed_seconds" | "fixed_minutes" | "random_range";
type SendMode = "NOW" | "SCHEDULED";
type CampaignMediaKind = "IMAGE" | "VIDEO" | "DOCUMENT";

type ClientMediaDefinition = {
  kind: CampaignMediaKind;
  extensions: readonly string[];
  maxSizeBytes: number;
};

const steps = ["Publico", "Mensagem", "Seguranca", "Revisao"];
const messageTokens = [
  "{{nome}}",
  "{{telefone}}",
  "{{email}}",
  "{{cidade}}",
  "{{estado}}",
  "{{origem}}",
  "{{lista}}",
  "{Oi|Ola|Bom dia}"
];
const MB = 1024 * 1024;
const CAMPAIGN_MEDIA_ACCEPT = ".jpg,.jpeg,.png,.webp,.mp4,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip";
const CLIENT_MEDIA_TYPES: Record<string, ClientMediaDefinition> = {
  "image/jpeg": { kind: "IMAGE", extensions: [".jpg", ".jpeg"], maxSizeBytes: 10 * MB },
  "image/png": { kind: "IMAGE", extensions: [".png"], maxSizeBytes: 10 * MB },
  "image/webp": { kind: "IMAGE", extensions: [".webp"], maxSizeBytes: 10 * MB },
  "video/mp4": { kind: "VIDEO", extensions: [".mp4"], maxSizeBytes: 20 * MB },
  "application/pdf": { kind: "DOCUMENT", extensions: [".pdf"], maxSizeBytes: 25 * MB },
  "application/msword": { kind: "DOCUMENT", extensions: [".doc"], maxSizeBytes: 25 * MB },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    kind: "DOCUMENT",
    extensions: [".docx"],
    maxSizeBytes: 25 * MB
  },
  "application/vnd.ms-excel": { kind: "DOCUMENT", extensions: [".xls"], maxSizeBytes: 25 * MB },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    kind: "DOCUMENT",
    extensions: [".xlsx"],
    maxSizeBytes: 25 * MB
  },
  "text/csv": { kind: "DOCUMENT", extensions: [".csv"], maxSizeBytes: 25 * MB },
  "text/plain": { kind: "DOCUMENT", extensions: [".txt"], maxSizeBytes: 25 * MB },
  "application/zip": { kind: "DOCUMENT", extensions: [".zip"], maxSizeBytes: 25 * MB }
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
    scheduled: "AGENDADA",
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

function getScheduleValidation(sendMode: SendMode, scheduledLocalDateTime: string) {
  if (sendMode === "NOW") {
    return { ok: true, error: null };
  }

  const scheduledAt = new Date(scheduledLocalDateTime);

  if (!scheduledLocalDateTime || Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: "Informe uma data e hora validas para o agendamento." };
  }

  if (scheduledAt.getTime() < Date.now() + 2 * 60 * 1000) {
    return { ok: false, error: "Escolha um horario com pelo menos 2 minutos de antecedencia." };
  }

  return { ok: true, error: null };
}

function formatLocalDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("pt-BR");
}

function formatFileSize(sizeBytes: number | null | undefined) {
  if (!sizeBytes) return "0 KB";
  if (sizeBytes >= MB) return `${(sizeBytes / MB).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function getFileExtension(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

function validateClientMedia(file: File) {
  const definition = CLIENT_MEDIA_TYPES[file.type.toLowerCase()];

  if (!definition) {
    return { ok: false as const, error: "Tipo de arquivo nao permitido." };
  }

  if (!definition.extensions.includes(getFileExtension(file.name))) {
    return { ok: false as const, error: "Extensao incompativel com o tipo do arquivo." };
  }

  if (file.size <= 0 || file.size > definition.maxSizeBytes) {
    return {
      ok: false as const,
      error: `O arquivo deve ter ate ${definition.maxSizeBytes / MB} MB.`
    };
  }

  return { ok: true as const, definition };
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

function safeWhatsappPreviewName(name: string | null | undefined, jid: string | null | undefined) {
  const text = name?.trim() ?? "";
  const normalizedJid = jid?.trim().toLowerCase() ?? "";

  if (text && !text.includes("@")) {
    return text;
  }

  if (normalizedJid.endsWith("@lid")) {
    return "Contato sem número resolvido";
  }

  return jid ?? "Contato WhatsApp";
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
  const activeInstanceId = prefillContext?.instanceId ?? "";
  const [step, setStep] = useState(0);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [catalogChats, setCatalogChats] = useState<ChatPreview[]>(prefillContext?.chatPreview ?? []);
  const [selectedCatalogChatIds, setSelectedCatalogChatIds] = useState<Set<string>>(
    new Set(prefillContext?.chatPreview.map((chat) => chat.id) ?? [])
  );
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(
    new Set(prefillContext?.contactPreview.map((contact) => contact.id) ?? [])
  );
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<RecipientDetail[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [delayMode, setDelayMode] = useState<DelayMode>("random_range");
  const [fixedSeconds, setFixedSeconds] = useState(60);
  const [fixedMinutes, setFixedMinutes] = useState(1);
  const [minDelaySeconds, setMinDelaySeconds] = useState(30);
  const [maxDelaySeconds, setMaxDelaySeconds] = useState(90);
  const [pauseEvery, setPauseEvery] = useState(25);
  const [pauseMinutes, setPauseMinutes] = useState(10);
  const [batchLimit, setBatchLimit] = useState(100);
  const [sendMode, setSendMode] = useState<SendMode>("NOW");
  const [scheduledLocalDateTime, setScheduledLocalDateTime] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaKind, setMediaKind] = useState<CampaignMediaKind | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testFeedback, setTestFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const [showRecentCampaigns, setShowRecentCampaigns] = useState(true);
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
  const messageTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const previousInstanceIdRef = useRef(activeInstanceId);

  const selectableContacts = useMemo(
    () => contacts.filter((contact) => !contact.optedOut),
    [contacts]
  );
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
        ? selectedCatalogChatIds.size
        : selectedContacts.size;
  const securityConfirmed = confirmedAudience && confirmedMessage && confirmedGroups;
  const scheduleValidation = getScheduleValidation(sendMode, scheduledLocalDateTime);
  const canCreate =
    Boolean(name.trim()) &&
    Boolean(message.trim()) &&
    intervalMinutes >= 1 &&
    audienceCount > 0 &&
    scheduleValidation.ok &&
    !mediaError &&
    securityConfirmed;
  const sampleContact = prefilledContacts[0] ?? contacts[0] ?? null;
  const renderedPreviewMessage = previewMessage || (
    message.trim() ? renderCampaignMessage(message, sampleContact) : ""
  );

  function updateIntervalFromDelay(nextMode = delayMode) {
    const seconds =
      nextMode === "fixed_seconds"
        ? fixedSeconds
        : nextMode === "fixed_minutes"
          ? fixedMinutes * 60
          : Math.max(minDelaySeconds, maxDelaySeconds);
    setIntervalMinutes(Math.max(1, Math.ceil(seconds / 60)));
  }

  function generatePreview() {
    setPreviewMessage(renderCampaignMessage(message, sampleContact));
  }

  function clearMediaSelection() {
    setMediaFile(null);
    setMediaKind(null);
    setMediaPreviewUrl(null);
    setMediaError(null);
    if (mediaInputRef.current) mediaInputRef.current.value = "";
  }

  function handleMediaSelection(file: File | null) {
    if (!file) {
      clearMediaSelection();
      return;
    }

    const validation = validateClientMedia(file);

    if (!validation.ok) {
      setMediaFile(null);
      setMediaKind(null);
      setMediaPreviewUrl(null);
      setMediaError(validation.error);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
      return;
    }

    setMediaFile(file);
    setMediaKind(validation.definition.kind);
    setMediaError(null);
    setMediaPreviewUrl(
      validation.definition.kind === "IMAGE" || validation.definition.kind === "VIDEO"
        ? URL.createObjectURL(file)
        : null
    );
  }

  function insertMessageToken(token: string) {
    const textarea = messageTextareaRef.current;

    if (!textarea) {
      setMessage((current) => `${current}${current ? " " : ""}${token}`);
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextMessage = `${message.slice(0, start)}${token}${message.slice(end)}`;
    setMessage(nextMessage);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursor = start + token.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

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

  async function loadCatalogChats() {
    const loaded: ChatPreview[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const params = new URLSearchParams({
        type: "contacts",
        limit: "100",
        page: String(page)
      });
      if (activeInstanceId) params.set("instanceId", activeInstanceId);
      const response = await fetch(`/api/conversas?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as {
        chats?: Array<{
          id: string;
          jid: string;
          displayName?: string;
          identityLabel?: string;
        }>;
        pagination?: {
          totalPages?: number;
        };
      };

      loaded.push(
        ...(data.chats ?? []).map((chat) => ({
          id: chat.id,
          jid: chat.jid,
          name: chat.displayName ?? null,
          displayName: chat.displayName,
          identityLabel: chat.identityLabel
        }))
      );
      totalPages = Math.max(1, Number(data.pagination?.totalPages ?? 1));
      page += 1;
    } while (page <= totalPages && page <= 50);

    setCatalogChats(loaded);
    setSelectedCatalogChatIds((current) => {
      const validIds = new Set(loaded.map((chat) => chat.id));
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));

      if (next.size > 0) {
        return next;
      }

      return new Set(loaded.map((chat) => chat.id));
    });
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
      await Promise.all([loadContacts(), loadCatalogChats(), loadCampaigns()]);
      if (selectedCampaignId) await loadRecipients(selectedCampaignId);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (previousInstanceIdRef.current !== activeInstanceId) {
      previousInstanceIdRef.current = activeInstanceId;
      setSelectedContacts(new Set());
      setSelectedCatalogChatIds(new Set());
      setSelectedCampaignId(null);
      setRecipients([]);
      setLabelAudience(null);
      setCreatedCampaignId(null);
      setCreatedMessage(null);
      setPreviewMessage("");
      setSendMode("NOW");
      setScheduledLocalDateTime("");
      setMediaFile(null);
      setMediaKind(null);
      setMediaPreviewUrl(null);
      setMediaError(null);
      if (mediaInputRef.current) mediaInputRef.current.value = "";
    }

    void refresh().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
    });
  }, [activeInstanceId]);

  useEffect(() => {
    return () => {
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    };
  }, [mediaPreviewUrl]);

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
  }, [audienceMode, selectedLabelId, activeInstanceId]);

  function toggleContact(contactId: string) {
    setSelectedContacts((current) => {
      const next = new Set(current);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  }

  function toggleCatalogChat(chatId: string) {
    setSelectedCatalogChatIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) next.delete(chatId);
      else next.add(chatId);
      return next;
    });
  }

  async function createCampaign() {
    setBusy(true);
    setError(null);
    setCreatedCampaignId(null);
    setCreatedMessage(null);

    try {
      const scheduleValidationResult = getScheduleValidation(sendMode, scheduledLocalDateTime);

      if (!scheduleValidationResult.ok) {
        throw new Error(scheduleValidationResult.error ?? "Agendamento invalido");
      }

      const scheduledAt =
        sendMode === "SCHEDULED" ? new Date(scheduledLocalDateTime).toISOString() : null;
      const body = {
        name: name.trim(),
        defaultMessage: message.trim(),
        message: message.trim(),
        intervalMinutes,
        sendMode,
        scheduledAt,
        advancedSettings: {
          delayMode,
          fixedSeconds,
          fixedMinutes,
          minDelaySeconds,
          maxDelaySeconds,
          pauseEvery,
          pauseMinutes,
          batchLimit
        }
      };
      const endpoint =
        audienceMode === "label"
          ? `/api/etiquetas/${selectedLabelId}/campaigns`
          : "/api/campaigns";
      const requestPayload =
        audienceMode === "label"
          ? {
              instanceId: activeInstanceId,
              name: body.name,
              message: body.message,
              intervalMinutes,
              advancedSettings: body.advancedSettings,
              maxRecipients: batchLimit,
              sendMode: body.sendMode,
              scheduledAt: body.scheduledAt,
              startNow: false
            }
          : {
              name: body.name,
              defaultMessage: body.defaultMessage,
              intervalMinutes,
              advancedSettings: body.advancedSettings,
              maxRecipients: batchLimit,
              instanceId: activeInstanceId,
              sendMode: body.sendMode,
              scheduledAt: body.scheduledAt,
              contactIds: audienceMode === "contacts" ? Array.from(selectedContacts) : [],
              chatIds: audienceMode === "catalog" ? Array.from(selectedCatalogChatIds) : []
            };
      let response: Response;

      if (mediaFile) {
        const formData = new FormData();
        formData.append("payload", JSON.stringify(requestPayload));
        formData.append("media", mediaFile);
        response = await fetch(endpoint, {
          method: "POST",
          body: formData
        });
      } else {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestPayload)
        });
      }
      const data = await response.json();

      if (!response.ok) throw new Error(String(data.error ?? "Erro ao criar campanha"));

      const campaignId = String(data.campaign?.id ?? data.id ?? "");
      setCreatedCampaignId(campaignId || null);
      setCreatedMessage(String(data.message ?? "Campanha criada em rascunho."));
      setSelectedCampaignId(campaignId || null);
      clearMediaSelection();
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

  async function sendTestMessage() {
    setTestBusy(true);
    setTestFeedback(null);

    try {
      const response = await fetch("/api/campaigns/test-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: activeInstanceId,
          phone: testPhone,
          message,
          sampleName: sampleContact?.name ?? "Teste"
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(String(data.error ?? "Erro ao enviar teste"));
      }

      setTestFeedback({
        tone: "success",
        text: String(data.message ?? "Mensagem de teste enviada.")
      });
    } catch (testError) {
      setTestFeedback({
        tone: "error",
        text: testError instanceof Error ? testError.message : "Erro inesperado"
      });
    } finally {
      setTestBusy(false);
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
                    <span>
                      {selectedCatalogChatIds.size} de {catalogChats.length} selecionados
                    </span>
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
                      {(labelAudience?.skippedReasons.unresolved_lid ?? 0) > 0 ? (
                        <span>{labelAudience?.skippedReasons.unresolved_lid} sem número</span>
                      ) : null}
                    </div>
                    <ul className="list-plain">
                      {(labelAudience?.recipientsPreview ?? []).map((recipient) => (
                        <li key={recipient.chatId}>
                          {recipient.displayName ?? safeWhatsappPreviewName(recipient.name, recipient.jid)}{" "}
                          <span className="muted">
                            {recipient.displayPhone || recipient.displaySubtitle || `(${recipient.jidType})`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {audienceMode === "catalog" ? (
                  <div className="data-card compact">
                    <div className="table-toolbar">
                      <div>
                        <strong>Contatos WhatsApp</strong>
                        <span className="muted">
                          {selectedCatalogChatIds.size} de {catalogChats.length} selecionados
                        </span>
                      </div>
                      <div className="button-row">
                        <button
                          className="button secondary compact-button"
                          type="button"
                          onClick={() => setSelectedCatalogChatIds(new Set(catalogChats.map((chat) => chat.id)))}
                        >
                          Selecionar todos
                        </button>
                        <button
                          className="button secondary compact-button"
                          type="button"
                          onClick={() => setSelectedCatalogChatIds(new Set())}
                        >
                          Limpar
                        </button>
                      </div>
                    </div>
                    <ul className="list-plain">
                      {catalogChats.length === 0 ? (
                        <li>Nenhum contato WhatsApp encontrado para esta instancia.</li>
                      ) : (
                        catalogChats.slice(0, 100).map((chat) => (
                          <li key={chat.id}>
                            <label className="contact-option">
                              <input
                                checked={selectedCatalogChatIds.has(chat.id)}
                                type="checkbox"
                                onChange={() => toggleCatalogChat(chat.id)}
                              />
                              <span>
                                <strong>{chat.displayName ?? chat.name ?? "Contato WhatsApp"}</strong>
                                <br />
                                <span className="muted">{chat.identityLabel ?? chat.jid}</span>
                              </span>
                            </label>
                          </li>
                        ))
                      )}
                    </ul>
                    {catalogChats.length > 100 ? (
                      <div className="message compact">
                        Mostrando 100 de {catalogChats.length}. Use Selecionar todos para incluir toda a base WhatsApp.
                      </div>
                    ) : null}
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
                    ref={messageTextareaRef}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                  <span className="muted">{message.length}/4000 caracteres</span>
                  <div className="token-row" aria-label="Inserir variaveis">
                    {messageTokens.map((token) => (
                      <button
                        className="token-chip"
                        key={token}
                        type="button"
                        onClick={() => insertMessageToken(token)}
                      >
                        {token}
                      </button>
                    ))}
                  </div>
                  <div className="button-row">
                    <button className="button secondary compact-button" type="button" onClick={generatePreview}>
                      Gerar preview
                    </button>
                    <span className="muted">O preview usa variaveis e spintax com dados de exemplo.</span>
                  </div>
                </div>
                <div className="field campaign-media-field">
                  <label htmlFor="campaign-media">Anexo opcional</label>
                  <span className="muted">
                    Adicione uma imagem, video ou documento. E permitido um arquivo por campanha.
                  </span>
                  <input
                    accept={CAMPAIGN_MEDIA_ACCEPT}
                    className="input"
                    id="campaign-media"
                    ref={mediaInputRef}
                    type="file"
                    onChange={(event) => handleMediaSelection(event.target.files?.[0] ?? null)}
                  />
                  <span className="muted">
                    Imagens ate 10 MB, MP4 ate 20 MB e documentos ate 25 MB.
                  </span>
                  {mediaError ? <span className="send-error">{mediaError}</span> : null}
                  {mediaFile && mediaKind ? (
                    <div className="campaign-media-selection">
                      {mediaKind === "IMAGE" && mediaPreviewUrl ? (
                        <img
                          alt={`Preview de ${mediaFile.name}`}
                          className="campaign-media-preview"
                          src={mediaPreviewUrl}
                        />
                      ) : null}
                      {mediaKind === "VIDEO" && mediaPreviewUrl ? (
                        <video className="campaign-media-preview" controls preload="metadata">
                          <source src={mediaPreviewUrl} type={mediaFile.type} />
                        </video>
                      ) : null}
                      {mediaKind === "DOCUMENT" ? (
                        <div className="campaign-document-preview">
                          <strong>{getFileExtension(mediaFile.name).replace(".", "").toUpperCase()}</strong>
                          <span>Documento</span>
                        </div>
                      ) : null}
                      <div>
                        <strong>{mediaFile.name}</strong>
                        <span className="muted">
                          {mediaKind} | {formatFileSize(mediaFile.size)}
                        </span>
                      </div>
                      <button
                        className="button secondary compact-button"
                        type="button"
                        onClick={clearMediaSelection}
                      >
                        Remover
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <span>Quando enviar</span>
                  <div className="filter-bar">
                    <label className="check-card">
                      <input
                        checked={sendMode === "NOW"}
                        name="send-mode"
                        type="radio"
                        onChange={() => {
                          setSendMode("NOW");
                          setScheduledLocalDateTime("");
                        }}
                      />
                      <span>Enviar agora</span>
                    </label>
                    <label className="check-card">
                      <input
                        checked={sendMode === "SCHEDULED"}
                        name="send-mode"
                        type="radio"
                        onChange={() => setSendMode("SCHEDULED")}
                      />
                      <span>Agendar envio</span>
                    </label>
                  </div>
                </div>
                {sendMode === "SCHEDULED" ? (
                  <div className="field">
                    <label htmlFor="campaign-scheduled-at">Data e hora do envio</label>
                    <input
                      className="input"
                      id="campaign-scheduled-at"
                      type="datetime-local"
                      value={scheduledLocalDateTime}
                      onChange={(event) => setScheduledLocalDateTime(event.target.value)}
                    />
                    <span className={scheduleValidation.ok ? "muted" : "send-error"}>
                      {scheduleValidation.error ?? "O horario sera salvo em UTC."}
                    </span>
                  </div>
                ) : null}
                <div className="filter-bar">
                  <div className="field">
                    <label htmlFor="test-phone">Telefone de teste</label>
                    <input
                      className="input"
                      id="test-phone"
                      placeholder="DDD + numero"
                      value={testPhone}
                      onChange={(event) => setTestPhone(event.target.value)}
                    />
                  </div>
                  <button
                    className="button secondary"
                    disabled={testBusy || !message.trim() || !testPhone.trim()}
                    type="button"
                    onClick={() => void sendTestMessage()}
                  >
                    {testBusy ? "Enviando..." : "Enviar teste para meu numero"}
                  </button>
                </div>
                {testFeedback ? (
                  <div className={`message compact ${testFeedback.tone === "error" ? "error" : ""}`}>
                    {testFeedback.text}
                  </div>
                ) : null}
                <div className="field">
                  <label htmlFor="delay-mode">Delay seguro</label>
                  <select
                    className="select"
                    id="delay-mode"
                    value={delayMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as DelayMode;
                      setDelayMode(nextMode);
                      updateIntervalFromDelay(nextMode);
                    }}
                  >
                    <option value="fixed_seconds">Fixo em segundos</option>
                    <option value="fixed_minutes">Fixo em minutos</option>
                    <option value="random_range">Aleatorio minimo/maximo</option>
                  </select>
                </div>
                {delayMode === "fixed_seconds" ? (
                  <div className="field">
                    <label htmlFor="fixed-seconds">Segundos entre envios</label>
                    <input
                      className="input"
                      id="fixed-seconds"
                      min="10"
                      type="number"
                      value={fixedSeconds}
                      onChange={(event) => {
                        setFixedSeconds(Number(event.target.value));
                        setIntervalMinutes(Math.max(1, Math.ceil(Number(event.target.value) / 60)));
                      }}
                    />
                  </div>
                ) : null}
                {delayMode === "fixed_minutes" ? (
                  <div className="field">
                    <label htmlFor="fixed-minutes">Minutos entre envios</label>
                    <input
                      className="input"
                      id="fixed-minutes"
                      min="1"
                      type="number"
                      value={fixedMinutes}
                      onChange={(event) => {
                        setFixedMinutes(Number(event.target.value));
                        setIntervalMinutes(Math.max(1, Number(event.target.value)));
                      }}
                    />
                  </div>
                ) : null}
                {delayMode === "random_range" ? (
                  <div className="filter-bar">
                    <div className="field">
                      <label htmlFor="min-delay">Minimo segundos</label>
                      <input className="input" id="min-delay" min="10" type="number" value={minDelaySeconds} onChange={(event) => setMinDelaySeconds(Number(event.target.value))} />
                    </div>
                    <div className="field">
                      <label htmlFor="max-delay">Maximo segundos</label>
                      <input className="input" id="max-delay" min={minDelaySeconds} type="number" value={maxDelaySeconds} onChange={(event) => {
                        setMaxDelaySeconds(Number(event.target.value));
                        setIntervalMinutes(Math.max(1, Math.ceil(Number(event.target.value) / 60)));
                      }} />
                    </div>
                  </div>
                ) : null}
                <div className="filter-bar">
                  <div className="field">
                    <label htmlFor="pause-every">Pausar a cada X mensagens</label>
                    <input className="input" id="pause-every" min="1" type="number" value={pauseEvery} onChange={(event) => setPauseEvery(Number(event.target.value))} />
                  </div>
                  <div className="field">
                    <label htmlFor="pause-minutes">Tempo da pausa em minutos</label>
                    <input className="input" id="pause-minutes" min="1" type="number" value={pauseMinutes} onChange={(event) => setPauseMinutes(Number(event.target.value))} />
                  </div>
                  <div className="field">
                    <label htmlFor="batch-limit">Limite do lote</label>
                    <input className="input" id="batch-limit" min="1" max="500" type="number" value={batchLimit} onChange={(event) => setBatchLimit(Number(event.target.value))} />
                  </div>
                </div>
                <div className="message warning compact">
                  Comece com 2 a 5 contatos, aumente gradualmente, evite listas frias e mensagens identicas.
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
                    <li>Delay: {delayMode === "random_range" ? `${minDelaySeconds}-${maxDelaySeconds}s` : `${intervalMinutes}min equivalente`}</li>
                    <li>Pausa: {pauseMinutes}min a cada {pauseEvery} mensagens</li>
                    <li>Limite do lote: {batchLimit}</li>
                    <li>Mensagem: {message.trim() ? "preenchida" : "pendente"}</li>
                    <li>
                      Anexo: {mediaFile && mediaKind
                        ? `${mediaFile.name} | ${mediaKind} | ${formatFileSize(mediaFile.size)}`
                        : "sem anexo"}
                    </li>
                    <li>Legenda futura: {mediaFile ? "mensagem da campanha" : "nao aplicavel"}</li>
                    <li>
                      Envio: {sendMode === "NOW"
                        ? "imediato apos inicio manual"
                        : `agendada para ${formatLocalDateTime(scheduledLocalDateTime)}`}
                    </li>
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
                disabled={
                  step === steps.length - 1 ||
                  (step === 1 && (!scheduleValidation.ok || Boolean(mediaError)))
                }
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
            <div className="meta-row">
              <span>Envio</span>
              <span>
                {sendMode === "NOW"
                  ? "Imediato"
                  : formatLocalDateTime(scheduledLocalDateTime)}
              </span>
            </div>
            <div className="meta-row">
              <span>Anexo</span>
              <span>{mediaFile ? `${mediaKind} | ${formatFileSize(mediaFile.size)}` : "Nenhum"}</span>
            </div>
          </div>
          <div className="wa-preview">
            <div className="wa-preview-top">
              <span>WA</span>
              <strong>{sampleContact?.name ?? "Contato exemplo"}</strong>
            </div>
            <div className="wa-preview-screen">
              {renderedPreviewMessage ? (
                <div className="wa-bubble">{renderedPreviewMessage}</div>
              ) : (
                <div className="wa-empty">Digite a mensagem para visualizar o envio.</div>
              )}
            </div>
          </div>
        </aside>
      </section>

      <section className="data-card campaigns-recent-card">
        <div className="table-toolbar">
          <div>
            <strong>Campanhas recentes</strong>
            <span className="muted">{campaigns.length} campanha(s)</span>
          </div>
          <div className="button-row">
            <button
              className="button secondary compact-button"
              type="button"
              onClick={() => setShowRecentCampaigns((current) => !current)}
            >
              {showRecentCampaigns ? "Recolher" : "Mostrar"}
            </button>
            <button className="button secondary compact-button" type="button" onClick={() => void refresh()}>
              Atualizar
            </button>
          </div>
        </div>
        {showRecentCampaigns && loading ? (
          <div className="empty-state compact">Carregando campanhas...</div>
        ) : showRecentCampaigns && campaigns.length === 0 ? (
          <div className="empty-state compact">
            <strong>Nenhuma campanha criada</strong>
            <span>Crie um rascunho para iniciar os envios.</span>
          </div>
        ) : showRecentCampaigns ? (
          <>
          <div className="table-wrap campaigns-table-wrap">
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
                    <td>
                      <strong>{campaign.name}</strong>
                      {campaign.status === "scheduled" ? (
                        <span className="muted">
                          {formatLocalDateTime(campaign.scheduledAt)}
                        </span>
                      ) : null}
                      {campaign.hasMedia ? (
                        <span className="muted">
                          Anexo: {campaign.mediaKind} | {campaign.mediaOriginalName} | {formatFileSize(campaign.mediaSizeBytes)}
                        </span>
                      ) : null}
                      {campaign.lastError ? (
                        <span className="send-error">{campaign.lastError}</span>
                      ) : null}
                    </td>
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
                        {campaign.status === "running" ? (
                          <button
                            className="button secondary compact-button"
                            disabled={busy}
                            type="button"
                            onClick={() => void runAction(campaign.id, "pause")}
                          >
                            Pausar
                          </button>
                        ) : (
                          <button
                            className="button secondary compact-button"
                            disabled={busy || !["draft", "scheduled", "paused"].includes(campaign.status)}
                            type="button"
                            onClick={() => void runAction(campaign.id, campaign.status === "paused" ? "resume" : "start")}
                          >
                            {campaign.status === "paused"
                              ? "Retomar"
                              : campaign.status === "scheduled"
                                ? "Iniciar agora"
                                : "Iniciar"}
                          </button>
                        )}
                        <Link
                          className="button secondary compact-button"
                          href={`/envios?campaign=${campaign.id}${activeInstanceId ? `&instanceId=${activeInstanceId}` : ""}`}
                        >
                          Acompanhar
                        </Link>
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
          <div className="campaign-mobile-list">
            {campaigns.map((campaign) => (
              <article className="campaign-mobile-card" key={campaign.id}>
                <div>
                  <strong>{campaign.name}</strong>
                  <span className="muted">{campaign.targetLabel?.name ?? campaignAudienceLabel(campaign.targetMode)}</span>
                  {campaign.status === "scheduled" ? (
                    <span className="muted">{formatLocalDateTime(campaign.scheduledAt)}</span>
                  ) : null}
                  {campaign.hasMedia ? (
                    <span className="muted">
                      Anexo: {campaign.mediaKind} | {campaign.mediaOriginalName} | {formatFileSize(campaign.mediaSizeBytes)}
                    </span>
                  ) : null}
                  {campaign.lastError ? (
                    <span className="send-error">{campaign.lastError}</span>
                  ) : null}
                </div>
                <span className={`status-badge ${statusClass(campaign.status)}`}>
                  {statusLabel(campaign.status)}
                </span>
                <p>
                  {campaign.recipientCount} total | {campaign.recipientStatusCounts.sent ?? 0} enviados |{" "}
                  {campaign.recipientStatusCounts.failed ?? 0} falhas |{" "}
                  {getPendingCount(campaign.recipientStatusCounts)} pendentes
                </p>
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
                  {campaign.status === "running" ? (
                    <button
                      className="button secondary compact-button"
                      disabled={busy}
                      type="button"
                      onClick={() => void runAction(campaign.id, "pause")}
                    >
                      Pausar
                    </button>
                  ) : (
                    <button
                      className="button secondary compact-button"
                      disabled={busy || !["draft", "scheduled", "paused"].includes(campaign.status)}
                      type="button"
                      onClick={() => void runAction(campaign.id, campaign.status === "paused" ? "resume" : "start")}
                    >
                      {campaign.status === "paused"
                        ? "Retomar"
                        : campaign.status === "scheduled"
                          ? "Iniciar agora"
                          : "Iniciar"}
                    </button>
                  )}
                  <Link
                    className="button secondary compact-button"
                    href={`/envios?campaign=${campaign.id}${activeInstanceId ? `&instanceId=${activeInstanceId}` : ""}`}
                  >
                    Acompanhar
                  </Link>
                  <button
                    className="button danger compact-button"
                    disabled={busy || ["completed", "canceled"].includes(campaign.status)}
                    type="button"
                    onClick={() => void runAction(campaign.id, "cancel")}
                  >
                    Cancelar
                  </button>
                </div>
              </article>
            ))}
          </div>
          </>
        ) : null}

        {showRecentCampaigns && selectedCampaignId ? (
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
                      <strong>{recipient.displayName || "Contato sem número resolvido"}</strong>
                      <span className="muted">
                        {recipient.displayPhone || recipient.displaySubtitle}
                      </span>
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
