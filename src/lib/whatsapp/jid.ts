export const WHATSAPP_X1_ONLY_MODE = true;

export function isGroupJid(jid: string | null | undefined) {
  return Boolean(jid?.trim().toLowerCase().endsWith("@g.us"));
}

export function isBroadcastOrNewsletterJid(jid: string | null | undefined) {
  const normalized = jid?.trim().toLowerCase() ?? "";

  return (
    !normalized ||
    normalized === "status@broadcast" ||
    normalized.endsWith("@broadcast") ||
    normalized.includes("newsletter")
  );
}

export function isIndividualJid(jid: string | null | undefined) {
  const normalized = jid?.trim().toLowerCase() ?? "";

  return normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@lid");
}

export function shouldIgnoreJidForX1Only(jid: string | null | undefined) {
  if (!WHATSAPP_X1_ONLY_MODE) {
    return false;
  }

  return isGroupJid(jid) || isBroadcastOrNewsletterJid(jid);
}
