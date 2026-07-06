"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type SendMessageResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
};

type SendMessageFormProps = {
  chatId: string;
  isGroup: boolean;
};

export function SendMessageForm({ chatId, isGroup }: SendMessageFormProps) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/conversas/${chatId}/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text
        })
      });
      const data = (await response.json()) as SendMessageResponse;

      if (!response.ok) {
        throw new Error(data.error ?? "Erro ao enviar mensagem");
      }

      setText("");
      setMessage(data.message ?? "Mensagem enviada para fila");
      setTimeout(() => router.refresh(), 1500);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="composer-form" onSubmit={(event) => void handleSubmit(event)}>
      {isGroup ? (
        <div className="inline-note">
          Esta conversa e um grupo. A mensagem manual sera enviada para todos os participantes.
        </div>
      ) : null}
      <div className="composer-row">
        <textarea
          className="composer-input"
          id="manual-message"
          maxLength={4000}
          placeholder="Digite uma mensagem"
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <button className="button" disabled={busy || !text.trim()} type="submit">
          {busy ? "Enfileirando..." : "Enviar"}
        </button>
      </div>
      <span className="muted">{text.length}/4000</span>
      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </form>
  );
}
