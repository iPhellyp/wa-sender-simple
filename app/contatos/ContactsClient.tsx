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
  duplicatedRows: number;
  invalidRows: number;
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

  useEffect(() => {
    void loadContacts();
  }, [source, optedOut, sendStatus, search, page, pageSize]);

  return (
    <section className="grid">
      <div className="page-header">
        <div>
          <span className="eyebrow">Base operacional</span>
          <h1>Contatos</h1>
          <p>
            Use contatos importados para campanhas manuais ou segmentacoes fora das etiquetas do
            WhatsApp.
          </p>
        </div>
        <Link className="button secondary" href="/campanhas">
          Abrir campanhas
        </Link>
      </div>

      <section className="section-card">
        <div className="section-card-header">
          <div>
            <h2>Importar planilha</h2>
            <p>Arquivo Excel .xlsx com nome, telefone e mensagem opcional.</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={(event) => void handleImport(event)}>
          <div className="field">
            <label htmlFor="file">Planilha Excel</label>
            <input className="input" id="file" name="file" type="file" accept=".xlsx" />
          </div>
          <button className="button" disabled={importing} type="submit">
            {importing ? "Importando..." : "Importar contatos"}
          </button>
        </form>
        {error ? <div className="message error">{error}</div> : null}
        {result ? (
          <div className="message">
            Total {result.totalRows} | Inseridos {result.insertedRows} | Duplicados{" "}
            {result.duplicatedRows} | Invalidos {result.invalidRows}
          </div>
        ) : null}
      </section>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Total contatos</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="stat-card">
          <span>Opt-out</span>
          <strong>{summary.optedOut}</strong>
        </div>
        <div className="stat-card">
          <span>Elegiveis</span>
          <strong>{summary.eligible}</strong>
        </div>
        <div className="stat-card">
          <span>Ja enviados</span>
          <strong>{summary.sent}</strong>
        </div>
        <div className="stat-card">
          <span>Nunca enviados</span>
          <strong>{summary.neverSent}</strong>
        </div>
        <div className="stat-card">
          <span>Falhas</span>
          <strong>{summary.failed}</strong>
        </div>
      </div>

      <section className="section-card">
        <div className="toolbar">
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
            className="input"
            value={source}
            onChange={(event) => {
              setPage(1);
              setSource(event.target.value);
            }}
          >
            <option value="">Todas as origens</option>
            {origins.map((origin) => (
              <option key={origin} value={origin}>
                {origin}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={optedOut}
            onChange={(event) => {
              setPage(1);
              setOptedOut(event.target.value);
            }}
          >
            <option value="">Todos opt-out</option>
            <option value="false">Nao opt-out</option>
            <option value="true">Opt-out</option>
          </select>
          <select
            className="input"
            value={sendStatus}
            onChange={(event) => {
              setPage(1);
              setSendStatus(event.target.value);
            }}
          >
            <option value="">Todos envios</option>
            <option value="sent">Ja enviado</option>
            <option value="never_sent">Nunca enviado</option>
            <option value="failed">Falhou</option>
            <option value="pending">Pendente</option>
          </select>
          <button className="button secondary" type="button" onClick={resetFilters}>
            Limpar filtros
          </button>
        </div>

        <div className="toolbar">
          <div className="button-row">
            <button className="button secondary compact-button" type="button" onClick={selectVisible}>
              Selecionar visiveis
            </button>
            <button
              className="button secondary compact-button"
              type="button"
              onClick={() => setSelectedContacts(new Set())}
            >
              Limpar selecao
            </button>
            <span className="muted">{selectedContacts.size} selecionado(s)</span>
          </div>
          <Link
            className={`button ${selectedContacts.size === 0 ? "secondary" : ""}`}
            href={selectedContacts.size === 0 ? "/contatos" : campaignUrl}
            aria-disabled={selectedContacts.size === 0}
          >
            Criar campanha
          </Link>
        </div>

        {hasSelectionOverflow ? (
          <div className="message warning">
            A URL foi limitada aos primeiros {CAMPAIGN_CONTACT_LIMIT} contatos selecionados.
          </div>
        ) : null}

        {loading ? (
          <div>Carregando...</div>
        ) : contacts.length === 0 ? (
          <div className="muted">Nenhum contato encontrado.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Normalizado</th>
                  <th>Origem</th>
                  <th>Opt-out</th>
                  <th>Ultimo envio</th>
                  <th>Status</th>
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
                      <td>{contact.name}</td>
                      <td>{contact.phoneRaw}</td>
                      <td>{contact.phoneNormalized}</td>
                      <td>{contact.source}</td>
                      <td>
                        <span className={`badge ${contact.optedOut ? "danger" : "success"}`}>
                          {contact.optedOut ? "sim" : "nao"}
                        </span>
                      </td>
                      <td>
                        {contact.lastSend ? (
                          <>
                            <strong>{contact.lastSend.campaignName}</strong>
                            <br />
                            <span className="muted">
                              {formatDate(contact.lastSend.sentAt ?? contact.lastSend.updatedAt)}
                            </span>
                          </>
                        ) : (
                          <span className="muted">Sem envio</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${statusClass(sendStatusValue)}`}>
                          {statusLabel(sendStatusValue)}
                        </span>
                        {contact.lastSend?.error ? (
                          <div className="muted">{contact.lastSend.error}</div>
                        ) : null}
                      </td>
                      <td>
                        <Link className="button secondary compact-button" href={`/campanhas?contactIds=${contact.id}`}>
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

        <div className="toolbar">
          <span className="muted">
            Pagina {page} de {totalPages} | {total} contato(s)
          </span>
          <div className="button-row">
            <select
              className="input"
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
