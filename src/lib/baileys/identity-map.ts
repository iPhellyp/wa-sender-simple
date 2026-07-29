import { prisma } from "../prisma/client";
import { normalizeBrazilPhone } from "../phone/normalize";

export type IdentityPair = {
  lidJid: string;
  phoneJid: string;
  source: string;
  evidence: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? value as Record<string, unknown> : null;
const asJid = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isLid = (jid: string) => jid.endsWith("@lid");
const isPhoneJid = (jid: string) => jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us");

function pair(a: unknown, b: unknown, source: string, evidence: string): IdentityPair | null {
  const first = asJid(a);
  const second = asJid(b);
  const lidJid = isLid(first) ? first : isLid(second) ? second : "";
  const phoneJid = isPhoneJid(first) ? first : isPhoneJid(second) ? second : "";
  return lidJid && phoneJid ? { lidJid, phoneJid, source, evidence } : null;
}

export function extractIdentityPairs(value: unknown, source = "BAILEYS_EVENT"): IdentityPair[] {
  const result = new Map<string, IdentityPair>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    const row = asRecord(candidate);
    if (!row) return;
    const key = asRecord(row.key);
    const pairs = [
      pair(row.remoteJid, row.remoteJidAlt, source, "remoteJid+remoteJidAlt"),
      pair(key?.remoteJid, key?.remoteJidAlt, source, "key.remoteJid+key.remoteJidAlt"),
      pair(row.participant, row.participantAlt, source, "participant+participantAlt"),
      pair(key?.participant, key?.participantAlt, source, "key.participant+key.participantAlt"),
      pair(row.senderPn, row.senderLid, source, "senderPn+senderLid"),
      pair(row.jid ?? row.id, row.lid, source, "contact.jid+contact.lid"),
      pair(row.oldJid, row.newJid, source, "chat.oldJid+chat.newJid")
    ].filter((item): item is IdentityPair => Boolean(item));
    for (const item of pairs) result.set(`${item.lidJid}|${item.phoneJid}`, item);
    for (const nested of Object.values(row)) visit(nested);
  };
  visit(value);
  return [...result.values()];
}

export async function persistIdentityPair(instanceId: string, input: IdentityPair) {
  const digits = input.phoneJid.split("@")[0]?.replace(/\D/g, "") ?? "";
  const normalized = normalizeBrazilPhone(digits);
  if (!normalized.ok) return { status: "ignored" as const };
  const phoneNormalized = normalized.normalized;
  const current = await prisma.whatsappIdentity.findUnique({
    where: { instanceId_lidJid: { instanceId, lidJid: input.lidJid } }
  });
  if (current?.confidence === "AMBIGUOUS") return { status: "ambiguous" as const };
  if (current?.phoneNormalized && current.phoneNormalized !== phoneNormalized) {
    await prisma.whatsappIdentity.update({
      where: { id: current.id },
      data: { phoneJid: null, phoneNormalized: null, confidence: "AMBIGUOUS",
        source: input.source, evidence: `${current.evidence}|${input.evidence}` }
    });
    return { status: "ambiguous" as const };
  }
  await prisma.whatsappIdentity.upsert({
    where: { instanceId_lidJid: { instanceId, lidJid: input.lidJid } },
    create: { instanceId, lidJid: input.lidJid, phoneJid: input.phoneJid,
      phoneNormalized, source: input.source, confidence: "DETERMINISTIC", evidence: input.evidence },
    update: { phoneJid: input.phoneJid, phoneNormalized, source: input.source,
      confidence: "DETERMINISTIC", evidence: input.evidence }
  });
  return { status: current ? "unchanged" as const : "created" as const };
}

export async function persistIdentityPairs(instanceId: string, value: unknown, source: string) {
  const counts = { observed: 0, created: 0, unchanged: 0, ambiguous: 0, ignored: 0 };
  for (const item of extractIdentityPairs(value, source)) {
    counts.observed++;
    const result = await persistIdentityPair(instanceId, item);
    counts[result.status]++;
  }
  return counts;
}

export async function rebuildPersistedIdentities(instanceId: string) {
  const [contacts, messages] = await Promise.all([
    prisma.whatsappContact.findMany({ where: { instanceId }, select: { jid: true, phone: true } }),
    prisma.whatsappMessage.findMany({ where: { instanceId }, select: { rawJson: true } })
  ]);
  const totals = { observed: 0, created: 0, unchanged: 0, ambiguous: 0, ignored: 0 };
  const consume = async (value: unknown, source: string) => {
    const found = await persistIdentityPairs(instanceId, value, source);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += found[key];
  };
  await consume(contacts.map((contact) => ({
    jid: contact.jid,
    lid: contact.jid.endsWith("@lid") ? contact.jid : undefined,
    id: contact.phone ? `${contact.phone}@s.whatsapp.net` : contact.jid
  })), "PERSISTED_CONTACT");
  for (const message of messages) await consume(message.rawJson, "PERSISTED_MESSAGE");
  return totals;
}

export async function getIdentityDiagnostics(instanceId: string) {
  const official = [
    "CRM 01 - Em atendimento", "CRM 02 - Qualificado",
    "CRM 03 - Inscrição no vestibular", "CRM 04 - Vestibular concluído",
    "CRM 05 - Matriculado", "CRM 99 - Perdido"
  ];
  const [phoneChats, lidChats, resolved, ambiguous, labeled] = await Promise.all([
    prisma.whatsappChat.count({ where: { instanceId, isGroup: false,
      OR: [{ jid: { endsWith: "@s.whatsapp.net" } }, { jid: { endsWith: "@c.us" } }] } }),
    prisma.whatsappChat.count({ where: { instanceId, isGroup: false, jid: { endsWith: "@lid" } } }),
    prisma.whatsappIdentity.count({ where: { instanceId, confidence: "DETERMINISTIC" } }),
    prisma.whatsappIdentity.count({ where: { instanceId, confidence: "AMBIGUOUS" } }),
    prisma.whatsappChat.findMany({ where: { instanceId, isGroup: false,
      labels: { some: { label: { deleted: false, name: { in: official } } } } },
      select: { jid: true } })
  ]);
  const lidJids = labeled.filter((chat) => isLid(chat.jid)).map((chat) => chat.jid);
  const labeledResolvedLids = lidJids.length ? await prisma.whatsappIdentity.count({
    where: { instanceId, lidJid: { in: lidJids }, confidence: "DETERMINISTIC" }
  }) : 0;
  const labeledPhone = labeled.length - lidJids.length;
  return { phoneChats, lidChats, resolvedLids: resolved, ambiguousLids: ambiguous,
    unresolvedLids: Math.max(0, lidChats - resolved), labeledContacts: labeled.length,
    labeledResolved: labeledPhone + labeledResolvedLids,
    labeledWithoutPhone: lidJids.length - labeledResolvedLids };
}
