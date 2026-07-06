export type PhoneNormalizationResult =
  | {
      ok: true;
      normalized: string;
    }
  | {
      ok: false;
      reason: string;
    };

export function normalizeBrazilPhone(input: string): PhoneNormalizationResult {
  let digits = String(input ?? "").replace(/\D/g, "");

  while (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0") && [13, 14].includes(digits.length)) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!digits) {
    return { ok: false, reason: "telefone vazio" };
  }

  const nationalNumber = digits.startsWith("55") ? digits.slice(2) : digits;

  if (![10, 11].includes(nationalNumber.length)) {
    return { ok: false, reason: "telefone brasileiro deve ter DDD e 8 ou 9 digitos" };
  }

  const ddd = Number(nationalNumber.slice(0, 2));

  if (Number.isNaN(ddd) || ddd < 11 || ddd > 99) {
    return { ok: false, reason: "DDD brasileiro invalido" };
  }

  return {
    ok: true,
    normalized: `55${nationalNumber}`
  };
}

export function toWhatsappJid(phoneNormalized: string) {
  return `${phoneNormalized}@s.whatsapp.net`;
}
