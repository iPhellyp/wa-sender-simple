"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

type ContactSendStatus = "sent" | "failed" | "pending" | "never_sent";

type Contact = {
  id: string;
  name: string;
  phoneRaw: string;
  phoneNormalized: string;
  message: string | null;
  source: string;
  optedOut: boolean;
  createdAt: string;
  lastSend: {
    status: ContactSendStatus;
    campaignId: string;
    campaignName: string;
    sentAt: string | null;
    updatedAt: string;
    error: string | null;
  } | null;
};

type ContactsSummary = {
  total: number;
  optedOut: number;
  eligible: number;
  sent: number;
  failed: number;
  pending: number;
  neverSent: number;
};

type ImportResult = {
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicatedRows: number;
  invalidRows: number;
};

type WhatsappLabel = {
  id: string;
  name: string;
  color: string | null;
};

const CAMPAIGN_CONTACT_LIMIT = 80;

function statusClass(status: ContactSendStatus) {
  if (status === "sent") return "success";
  if (status === "failed") return "danger";
  if (status === "pending") return "info";
  return "warning";
}

function statusLabel(status: ContactSendStatus) {
  if (status === "sent") return "ja enviado";
  if (status === "failed") return "falhou";
  if (status === "pending") return "pendente";
  return "nunca enviado";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ContactsClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [labels, setLabels] = useState<WhatsappLabel[]>([]);
  const [selectedLabelId, setSelectedLabelId] = useState("");
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<ContactsSummary>({
    total: 0,
    optedOut: 0,
    eligible: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    neverSent: 0
  });
  const [source, setSource] = useState("");
  const [optedOut, setOptedOut] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligibleVisibleContacts = useMemo(
    () => contacts.filter((contact) => !contact.optedOut),
    [contacts]
  );
  const selectedIds = Array.from(selectedContacts);
  const campaignIds = selectedIds.slice(0, CAMPAIGN_CONTACT_LIMIT);
  const campaignUrl = `/campanhas?contactIds=${campaignIds.join(",")}`;
  const hasSelectionOverflow = selectedIds.length > CAMPAIGN_CONTACT_LIMIT;
  const visibleStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = Math.min(total, page * pageSize);

  async function loadContacts() {
    setLoading(true);
    const params = new URLSearchParams();

    if (source) params.set("source", source);
    if (optedOut) params.set("optedOut", optedOut);
    if (sendStatus) params.set("sendStatus", sendStatus);
    if (search.trim()) params.set("search", search.trim());
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    try {
      const response = await fetch(`/api/contacts?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as {
        contacts: Contact[];
        origins: string[];
        summary: ContactsSummary;
        total: number;
        totalPages: number;
      };

      if (!response.ok) {
        throw new Error("Erro ao carregar contatos");
      }

      setContacts(data.contacts);
      setOrigins(data.origins);
      setSummary(data.summary);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  async function loadLabels() {
    const response = await fetch("/api/etiquetas", { cache: "no-store" });
    const data = (await response.json()) as { labels?: WhatsappLabel[] };
    setLabels(data.labels ?? []);
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setError("Selecione um arquivo .xlsx");
      return;
    }

    setImporting(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("importLabel", String(new FormData(form).get("importLabel") ?? ""));

    try {
      const response = await fetch("/api/import/excel", {
        method: "POST",
        body: formData
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(String(data.error ?? "Erro ao importar"));
      }

      setResult(data as ImportResult);
      form.reset();
      if (page === 1) {
        await loadContacts();
      } else {
        setPage(1);
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Erro inesperado");
    } finally {
      setImporting(false);
    }
  }

  function toggleContact(contact: Contact) {
    if (contact.optedOut) return;

    setSelectedContacts((current) => {
      const next = new Set(current);
      if (next.has(contact.id)) next.delete(contact.id);
      else next.add(contact.id);
      return next;
    });
  }

  function selectVisible() {
    setSelectedContacts((current) => {
      const next = new Set(current);
      for (const contact of eligibleVisibleContacts) {
        next.add(contact.id);
      }
      return next;
    });
  }

  function resetFilters() {
    setSource("");
    setOptedOut("");
    setSendStatus("");
    setSearch("");
    setPage(1);
  }

  async function applyBulkLabel() {
    if (selectedContacts.size === 0 || !selectedLabelId) {
      return;
    }

    setBulkMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/contacts/bulk-label", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contactIds: Array.from(selectedContacts),
          labelId: selectedLabelId
        })
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        updatedLocal?: number;
        queuedForWhatsapp?: number;
        skippedNoChat?: number;
      };

      if (!response.ok || data.error) {
        throw new Error(data.error ?? "Falha ao aplicar etiqueta");
      }

      setBulkMessage(
        `${data.message ?? "Etiqueta aplicada."} Local: ${data.updatedLocal ?? 0}. WhatsApp: ${
          data.queuedForWhatsapp ?? 0
        }. Sem conversa: ${data.skippedNoChat ?? 0}.`
      );
      await loadContacts();
    } catch (labelError) {
      setError(labelError instanceof Error ? labelError.message : "Erro inesperado");
    }
  }

  useEffect(() => {
    void loadContacts();
  }, [source, optedOut, sendStatus, search, page, pageSize]);

  useEffect(() => {
    void loadLabels();
  }, []);

  return (
    <section className="page-shell">
      <div className="page-topbar actions-only">
        <div />
        <div className="page-actions">
          <button
            className={`button ${showImportPanel ? "" : "secondary"}`}
            type="button"
            onClick={() => setShowImportPanel((current) => !current)}
          >
            Importar contatos
          </button>
          <Link className="button secondary" href="/campanhas">
            Criar campanha
          </Link>
        </div>
      </div>

      {showImportPanel ? (
        <section className="data-card compact" id="contact-import-panel">
          <form className="filter-bar import-panel" onSubmit={(event) => void handleImport(event)}>
            <div className="field">
              <label htmlFor="importLabel">Etiqueta da importacao</label>
              <input className="input" id="importLabel" name="importLabel" placeholder="Opcional" />
            </div>
            <div className="field">
              <label htmlFor="file">Planilha XLS/XLSX</label>
              <input className="input" id="file" name="file" type="file" accept=".xls,.xlsx" />
            </div>
            <button className="button" disabled={importing} type="submit">
              {importing ? "Importando..." : "Importar"}
            </button>
          </form>
          {result ? (
            <div className="message compact">
              Total {result.totalRows} | Inseridos {result.insertedRows} | Atualizados{" "}
              {result.updatedRows} | Duplicados {result.duplicatedRows} | Invalidos {result.invalidRows}
            </div>
          ) : null}
        </section>
      ) : null}

      {error ? <div className="message error compact">{error}</div> : null}
      {bulkMessage ? <div className="message compact">{bulkMessage}</div> : null}
      {hasSelectionOverflow ? (
        <div className="message warning compact">
          A URL foi limitada aos primeiros {CAMPAIGN_CONTACT_LIMIT} contatos selecionados.
        </div>
      ) : null}

      <div className="metric-grid">
        <article className="metric-card compact">
          <span>Total</span>
          <strong>{summary.total}</strong>
        </article>
        <article className="metric-card compact">
          <span>Elegiveis</span>
          <strong>{summary.eligible}</strong>
        </article>
        <article className="metric-card compact">
          <span>Opt-out</span>
          <strong>{summary.optedOut}</strong>
        </article>
        <article className="metric-card compact">
          <span>Ja enviados</span>
          <strong>{summary.sent}</strong>
        </article>
        <article className="metric-card compact">
          <span>Nunca enviados</span>
          <strong>{summary.neverSent}</strong>
        </article>
        <article className="metric-card compact">
          <span>Falhas</span>
          <strong>{summary.failed}</strong>
        </article>
      </div>

      <section className="data-card">
        <div className="filter-bar">
          <input
            className="input"
            placeholder="Buscar por nome ou telefone"
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          <select
            className="select"
            value={source}
            onChange={(event) => {
              setPage(1);
              setSource(event.target.value);
            }}
          >
            <option value="">Todas as etiquetas</option>
            {origins.map((origin) => (
              <option key={origin} value={origin}>
                {origin}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={optedOut}
            onChange={(event) => {
              setPage(1);
              setOptedOut(event.target.value);
            }}
          >
            <option value="">Opt-out: todos</option>
            <option value="false">Nao opt-out</option>
            <option value="true">Opt-out</option>
          </select>
          <select
            className="select"
            value={sendStatus}
            onChange={(event) => {
              setPage(1);
              setSendStatus(event.target.value);
            }}
          >
            <option value="">Status: todos</option>
            <option value="sent">Ja enviado</option>
            <option value="never_sent">Nunca enviado</option>
            <option value="failed">Falhou</option>
            <option value="pending">Pendente</option>
          </select>
          <button className="button secondary" type="button" onClick={resetFilters}>
            Limpar
          </button>
        </div>

        {selectedContacts.size > 0 ? (
          <div className="bulk-action-bar">
            <strong>{selectedContacts.size} selecionado(s)</strong>
            <Link className="button compact-button" href={campaignUrl}>
              Criar campanha
            </Link>
            <select
              className="select"
              value={selectedLabelId}
              onChange={(event) => setSelectedLabelId(event.target.value)}
            >
              <option value="">Escolha uma etiqueta</option>
              {labels.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
            <button
              className="button secondary compact-button"
              disabled={!selectedLabelId}
              type="button"
              onClick={() => void applyBulkLabel()}
            >
              Aplicar etiqueta
            </button>
            <button
              className="button secondary compact-button"
              type="button"
              onClick={() => setSelectedContacts(new Set())}
            >
              Limpar selecao
            </button>
          </div>
        ) : null}

        <div className="table-toolbar">
          <div>
            <strong>Lista de contatos</strong>
            <span className="muted">
              {loading ? "Carregando..." : `${visibleStart}-${visibleEnd} de ${total}`}
            </span>
          </div>
          <button className="button secondary compact-button" type="button" onClick={selectVisible}>
            Selecionar visiveis
          </button>
        </div>

        {loading ? (
          <div className="empty-state compact">Carregando contatos...</div>
        ) : contacts.length === 0 ? (
          <div className="empty-state compact">
            <strong>Nenhum contato encontrado</strong>
            <span>Ajuste os filtros ou importe uma planilha.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th></th>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Data</th>
                  <th>Etiqueta</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => {
                  const sendStatusValue = contact.lastSend?.status ?? "never_sent";
                  return (
                    <tr key={contact.id}>
                      <td>
                        <input
                          checked={selectedContacts.has(contact.id)}
                          disabled={contact.optedOut}
                          type="checkbox"
                          onChange={() => toggleContact(contact)}
                        />
                      </td>
                      <td>
                        <div className="identity-cell">
                          <strong>{contact.name || "Sem nome"}</strong>
                          <span>
                            <span className={`status-badge ${statusClass(sendStatusValue)}`}>
                              {statusLabel(sendStatusValue)}
                            </span>
                            {contact.optedOut ? (
                              <span className="status-badge danger">opt-out</span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td>{contact.phoneRaw || contact.phoneNormalized}</td>
                      <td>{formatDate(contact.createdAt)}</td>
                      <td>{contact.source || "-"}</td>
                      <td>
                        <Link
                          className="button secondary compact-button"
                          href={`/campanhas?contactIds=${contact.id}`}
                        >
                          Campanha
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination-bar">
          <span className="muted">
            Pagina {page} de {totalPages} | {total} contato(s)
          </span>
          <div className="button-row">
            <select
              className="select compact-select"
              value={pageSize}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
            >
              <option value={25}>25 por pagina</option>
              <option value={50}>50 por pagina</option>
              <option value={100}>100 por pagina</option>
            </select>
            <button
              className="button secondary compact-button"
              disabled={page <= 1}
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </button>
            <button
              className="button secondary compact-button"
              disabled={page >= totalPages}
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              Proxima
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
