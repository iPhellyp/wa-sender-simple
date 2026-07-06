"use client";

import { FormEvent, useEffect, useState } from "react";

type Contact = {
  id: string;
  name: string;
  phoneRaw: string;
  phoneNormalized: string;
  message: string | null;
  source: string;
  optedOut: boolean;
  createdAt: string;
};

type ImportResult = {
  totalRows: number;
  insertedRows: number;
  duplicatedRows: number;
  invalidRows: number;
};

export function ContactsClient() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [optedOut, setOptedOut] = useState("");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadContacts() {
    setLoading(true);
    const params = new URLSearchParams();

    if (source) {
      params.set("source", source);
    }

    if (optedOut) {
      params.set("optedOut", optedOut);
    }

    const response = await fetch(`/api/contacts?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as {
      contacts: Contact[];
      origins: string[];
    };

    setContacts(data.contacts);
    setOrigins(data.origins);
    setLoading(false);
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
      await loadContacts();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Erro inesperado");
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    void loadContacts();
  }, [source, optedOut]);

  return (
    <section className="grid">
      <div className="card">
        <form className="form-grid" onSubmit={(event) => void handleImport(event)}>
          <div className="field">
            <label htmlFor="file">Planilha Excel</label>
            <input className="input" id="file" name="file" type="file" accept=".xlsx" />
          </div>
          <button className="button" disabled={importing} type="submit">
            {importing ? "Importando..." : "Importar"}
          </button>
        </form>
      </div>

      {error ? <div className="message error">{error}</div> : null}
      {result ? (
        <div className="message success">
          Total {result.totalRows} | Inseridos {result.insertedRows} | Duplicados{" "}
          {result.duplicatedRows} | Invalidos {result.invalidRows}
        </div>
      ) : null}

      <div className="card">
        <div className="button-row" style={{ marginBottom: 12 }}>
          <select className="select" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Todas as origens</option>
            {origins.map((origin) => (
              <option key={origin} value={origin}>
                {origin}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={optedOut}
            onChange={(event) => setOptedOut(event.target.value)}
          >
            <option value="">Todos opt-out</option>
            <option value="false">Nao opt-out</option>
            <option value="true">Opt-out</option>
          </select>
        </div>

        {loading ? (
          <div>Carregando...</div>
        ) : contacts.length === 0 ? (
          <div className="muted">Nenhum contato encontrado.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>Normalizado</th>
                  <th>Origem</th>
                  <th>Opt-out</th>
                  <th>Mensagem</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id}>
                    <td>{contact.name}</td>
                    <td>{contact.phoneRaw}</td>
                    <td>{contact.phoneNormalized}</td>
                    <td>{contact.source}</td>
                    <td>
                      <span className={`badge ${contact.optedOut ? "danger" : "success"}`}>
                        {contact.optedOut ? "sim" : "nao"}
                      </span>
                    </td>
                    <td>{contact.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
