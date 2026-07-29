const BRAZIL_E164 = /^55\d{10,11}$/;

export function brazilianPhoneAliases(phoneNormalized: string) {
  const aliases = new Set([phoneNormalized]);
  if (!BRAZIL_E164.test(phoneNormalized)) return [...aliases];

  if (phoneNormalized.length === 12) {
    aliases.add(`${phoneNormalized.slice(0, 4)}9${phoneNormalized.slice(4)}`);
  } else if (phoneNormalized[4] === "9") {
    aliases.add(`${phoneNormalized.slice(0, 4)}${phoneNormalized.slice(5)}`);
  }
  return [...aliases];
}

export function phoneJids(phoneNormalized: string) {
  return [
    `${phoneNormalized}@s.whatsapp.net`,
    `${phoneNormalized}@c.us`
  ];
}

export function phoneFromIndividualJid(jid: string | null | undefined) {
  const match = /^(\d+)@(s\.whatsapp\.net|c\.us)$/.exec(jid?.trim().toLowerCase() ?? "");
  return match?.[1] ?? null;
}

export function chooseResolvedPhone(
  requestedPhone: string,
  candidatePhones: Iterable<string>
) {
  const unique = [...new Set(candidatePhones)];
  if (unique.includes(requestedPhone)) return requestedPhone;
  if (unique.length === 0) return null;
  if (unique.length > 1) return "AMBIGUOUS";
  return unique[0];
}
