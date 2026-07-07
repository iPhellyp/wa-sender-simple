type DisplayNameSource = {
  jid: string;
  chatName?: string | null;
  contactName?: string | null;
  contactPushName?: string | null;
  isGroup?: boolean;
};

function compactText(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

function getJidLocalPart(jid: string | null | undefined) {
  const trimmed = jid?.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.split("@")[0]?.split(":")[0] ?? null;
}

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function looksLikeRawJid(value: string) {
  return /@(s\.whatsapp\.net|g\.us|lid)$/i.test(value);
}

function getJidTail(jid: string) {
  const local = getJidLocalPart(jid) ?? jid;
  const normalized = local.replace(/\D/g, "") || local;

  return normalized.slice(-6) || jid.slice(0, 6);
}

function formatCompactJid(jid: string) {
  if (jid.endsWith("@g.us")) {
    return `Grupo ${getJidTail(jid)}`;
  }

  if (jid.endsWith("@lid")) {
    return `Contato WhatsApp ${getJidTail(jid)}`;
  }

  return `jid ${getJidTail(jid)}`;
}

export function formatJidAsPhone(jid: string | null | undefined) {
  if (!jid?.endsWith("@s.whatsapp.net")) {
    return null;
  }

  const digits = onlyDigits(getJidLocalPart(jid));

  if (!digits) {
    return null;
  }

  if (digits.startsWith("55") && digits.length >= 12) {
    const national = digits.slice(2);
    const areaCode = national.slice(0, 2);
    const subscriber = national.slice(2);

    if (areaCode.length === 2 && subscriber.length === 9) {
      return `+55 (${areaCode}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`;
    }

    if (areaCode.length === 2 && subscriber.length === 8) {
      return `+55 (${areaCode}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
    }

    if (areaCode.length === 2 && subscriber.length > 0) {
      return `+55 (${areaCode}) ${subscriber}`;
    }
  }

  return `+${digits}`;
}

export function cleanDisplayName(value: string | null | undefined, jid?: string | null) {
  const candidate = compactText(value);

  if (!candidate) {
    return null;
  }

  const normalizedCandidate = candidate.toLowerCase();
  const normalizedJid = jid?.trim().toLowerCase() ?? null;

  if (normalizedJid && normalizedCandidate === normalizedJid) {
    return null;
  }

  if (looksLikeRawJid(candidate)) {
    return null;
  }

  const candidateDigits = onlyDigits(candidate);
  const jidDigits = onlyDigits(getJidLocalPart(jid ?? undefined));

  if (candidateDigits.length >= 8 && /^[+\d\s().-]+$/.test(candidate)) {
    return null;
  }

  if (candidateDigits && jidDigits && candidateDigits === jidDigits) {
    return null;
  }

  return candidate;
}

function getDisplayNameScore(value: string | null | undefined, jid?: string | null) {
  const candidate = cleanDisplayName(value, jid);

  if (!candidate) {
    return 0;
  }

  const normalized = candidate.toLowerCase();

  if (normalized === "contato sincronizado" || normalized.startsWith("grupo ")) {
    return 1;
  }

  if (onlyDigits(candidate).length >= 8) {
    return 2;
  }

  return 4;
}

export function isBetterDisplayName(
  current: string | null | undefined,
  candidate: string | null | undefined,
  jid?: string | null
) {
  const cleanCandidate = cleanDisplayName(candidate, jid);

  if (!cleanCandidate) {
    return false;
  }

  return getDisplayNameScore(cleanCandidate, jid) > getDisplayNameScore(current, jid);
}

export function getWhatsappDisplayName(source: DisplayNameSource) {
  const chatName = cleanDisplayName(source.chatName, source.jid);

  if (chatName) {
    return chatName;
  }

  const contactPushName = cleanDisplayName(source.contactPushName, source.jid);

  if (contactPushName) {
    return contactPushName;
  }

  const contactName = cleanDisplayName(source.contactName, source.jid);

  if (contactName) {
    return contactName;
  }

  const phone = formatJidAsPhone(source.jid);

  if (phone) {
    return phone;
  }

  if (source.jid.endsWith("@g.us") || source.isGroup) {
    return `Grupo ${getJidTail(source.jid)}`;
  }

  return formatCompactJid(source.jid);
}

export function getWhatsappIdentityLabel(jid: string) {
  const phone = formatJidAsPhone(jid);

  if (phone) {
    return phone;
  }

  if (jid.endsWith("@lid")) {
    return `Contato WhatsApp ${getJidTail(jid)}`;
  }

  return formatCompactJid(jid);
}
