"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type StartConversationResponse = {
  chatId?: string;
  redirectUrl?: string;
  error?: string;
};

export function StartConversationForm({ instanceId }: { instanceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/conversas/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          instanceId,
          phone,
          name
        })
      });
      const data = (await response.json()) as StartConversationResponse;

      if (!response.ok || !data.redirectUrl) {
        throw new Error(data.error ?? "Erro ao iniciar conversa");
      }

      router.push(data.redirectUrl);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="popover-action">
      <button className="button" type="button" onClick={() => setOpen((current) => !current)}>
        Nova conversa
      </button>

      {open ? (
        <form className="compact-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="field">
            <label htmlFor="new-conversation-phone">Telefone</label>
            <input
              className="input"
              id="new-conversation-phone"
              name="phone"
              placeholder="DDD + numero"
              required
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-conversation-name">Nome opcional</label>
            <input
              className="input"
              id="new-conversation-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error ? <div className="message error">{error}</div> : null}
          <button className="button" disabled={busy} type="submit">
            {busy ? "Abrindo..." : "Abrir conversa"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

