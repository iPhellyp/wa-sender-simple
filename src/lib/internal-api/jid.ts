export type InternalJidType =
  | "individual_phone"
  | "lid"
  | "group"
  | "broadcast"
  | "status"
  | "newsletter"
  | "unsupported";

export function classifyJid(value: string | null | undefined): InternalJidType {
  const jid = value?.trim().toLowerCase() ?? "";

  if (!jid) return "unsupported";
  if (jid === "status@broadcast") return "status";
  if (jid.endsWith("@lid")) return "lid";
  if (jid.endsWith("@g.us")) return "group";
  if (jid.includes("newsletter") || jid.includes("channel")) return "newsletter";
  if (jid.includes("broadcast")) return "broadcast";
  if (/^\d+@(s\.whatsapp\.net|c\.us)$/.test(jid)) return "individual_phone";
  return "unsupported";
}
