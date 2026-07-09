type ContactDisplayInput = {
  jid?: string | null;
  rawJid?: string | null;
  name?: string | null;
  chatName?: string | null;
  contactName?: string | null;
  pushName?: string | null;
  verifiedName?: string | null;
  notify?: string | null;
  phone?: string | null;
  phoneRaw?: string | null;
  phoneNormalized?: string | null;
};

function compactText(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : null;
}

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

export function isLidJid(value: string | null | undefined) {
  return Boolean(value?.trim().toLowerCase().endsWith("@lid"));
}

export function isPhoneJid(value: string | null | undefined) {
  const jid = value?.trim().toLowerCase() ?? "";
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us");
}

export function extractPhoneFromJid(value: string | null | undefined) {
  if (!isPhoneJid(value)) {
    return null;
  }

  const phone = value?.trim().split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
  return phone || null;
}

export function formatBrazilPhone(value: string | null | undefined) {
  const digits = onlyDigits(value);

  if (!digits) {
    return null;
  }

  if (digits.startsWith("55") && digits.length >= 12) {
    const national = digits.slice(2);
    const areaCode = national.slice(0, 2);
    const subscriber = national.slice(2);

    if (subscriber.length === 9) {
      return `+55 (${areaCode}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`;
    }

    if (subscriber.length === 8) {
      return `+55 (${areaCode}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
    }
  }

  return `+${digits}`;
}

export function isBadDisplayName(value: string | null | undefined) {
  const text = compactText(value);

  if (!text) {
    return true;
  }

  const normalized = text.toLowerCase();

  return (
    normalized.includes("@") ||
    normalized.endsWith("@lid") ||
    /^contato whatsapp\s+\S+$/i.test(text) ||
    /^[+\d\s().-]+$/.test(text)
  );
}

function firstGoodName(...values: Array<string | null | undefined>) {
  return values.map(compactText).find((value) => !isBadDisplayName(value)) ?? null;
}

function firstPhone(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const formatted = formatBrazilPhone(value);

    if (formatted) {
      return formatted;
    }
  }

  return null;
}

export function resolveContactDisplay(input: ContactDisplayInput): {
  displayName: string;
  displayPhone: string | null;
  displaySubtitle: string | null;
  rawJid: string | null;
} {
  const rawJid = compactText(input.rawJid ?? input.jid);
  const jidPhone = extractPhoneFromJid(rawJid);
  const displayPhone = firstPhone(input.phone, input.phoneRaw, input.phoneNormalized, jidPhone);
  const displayName = firstGoodName(
    input.name,
    input.contactName,
    input.chatName,
    input.pushName,
    input.verifiedName,
    input.notify
  );

  if (displayName) {
    return {
      displayName,
      displayPhone,
      displaySubtitle: displayPhone,
      rawJid
    };
  }

  if (displayPhone) {
    return {
      displayName: displayPhone,
      displayPhone,
      displaySubtitle: "Contato WhatsApp",
      rawJid
    };
  }

  if (isLidJid(rawJid)) {
    return {
      displayName: "Contato sem número resolvido",
      displayPhone: null,
      displaySubtitle: rawJid ? `lid: ${rawJid}` : null,
      rawJid
    };
  }

  return {
    displayName: "Contato WhatsApp",
    displayPhone: null,
    displaySubtitle: rawJid ? `JID: ${rawJid}` : "Sem identificador",
    rawJid
  };
}
