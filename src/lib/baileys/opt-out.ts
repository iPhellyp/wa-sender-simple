const OPT_OUT_WORDS = new Set(["PARAR", "SAIR", "STOP", "CANCELAR"]);

export function normalizeIncomingText(text: string) {
  return text
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

export function isOptOutMessage(text: string | null | undefined) {
  if (!text) {
    return false;
  }

  return OPT_OUT_WORDS.has(normalizeIncomingText(text));
}

export function extractMessageText(message: unknown): string | null {
  const payload = message as {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
    };
    imageMessage?: {
      caption?: string;
    };
    videoMessage?: {
      caption?: string;
    };
  } | null;

  return (
    payload?.conversation ??
    payload?.extendedTextMessage?.text ??
    payload?.imageMessage?.caption ??
    payload?.videoMessage?.caption ??
    null
  );
}
