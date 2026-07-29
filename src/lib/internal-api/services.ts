import type { WhatsappInstanceRole } from "@prisma/client";
import { WhatsappStatus } from "@prisma/client";
import { prisma } from "../prisma/client";
import {
  enqueueMutateWhatsappChatLabel,
  enqueueWhatsappCatalogSync,
  enqueueWhatsappConnect,
  enqueueWhatsappHistorySync,
  enqueueWhatsappPreserveDisconnect,
  enqueueWhatsappIdentityRebuild
} from "../queue/campaign-queue";
import { getWhatsappIdentityRebuildStatus } from "../queue/campaign-queue";
import { getIdentityDiagnostics } from "../baileys/identity-map";
import { createWhatsappInstance } from "../server/whatsapp-instances";
import { classifyJid } from "./jid";
import { InternalApiError } from "./errors";
import {
  brazilianPhoneAliases,
  chooseResolvedPhone,
  phoneFromIndividualJid,
  phoneJids
} from "./phone-resolution";

export async function requireInternalInstance(instanceId: string) {
  const instance = await prisma.whatsappInstance.findUnique({
    where: { id: instanceId }
  });
  if (!instance) {
    throw new InternalApiError("INSTANCE_NOT_FOUND", "Instância não encontrada", 404);
  }
  return instance;
}

export function sanitizeInstance(instance: {
  id: string;
  name: string;
  role: WhatsappInstanceRole;
  phone: string | null;
  status: WhatsappStatus;
  isDefault: boolean;
  lastConnectedAt: Date | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: instance.id,
    name: instance.name,
    role: instance.role,
    phone: instance.phone,
    status: instance.status,
    isDefault: instance.isDefault,
    lastConnectedAt: instance.lastConnectedAt?.toISOString() ?? null,
    lastSyncAt: instance.lastSyncAt?.toISOString() ?? null,
    createdAt: instance.createdAt.toISOString(),
    updatedAt: instance.updatedAt.toISOString()
  };
}

export async function listInternalInstances() {
  const instances = await prisma.whatsappInstance.findMany({
    orderBy: { createdAt: "asc" }
  });
  return instances.map(sanitizeInstance);
}

export async function createInternalInstance(name: string, role: WhatsappInstanceRole) {
  const result = await createWhatsappInstance({ name, role, reuseExisting: true });
  return {
    instance: sanitizeInstance(result.instance),
    created: result.created
  };
}

export async function getInternalInstanceStatus(instanceId: string) {
  const instance = await requireInternalInstance(instanceId);
  const session = await prisma.whatsappSession.findFirst({
    where: { instanceId },
    orderBy: { updatedAt: "desc" },
    select: {
      status: true,
      connectedPhone: true,
      lastError: true,
      qrCode: true,
      updatedAt: true
    }
  });
  const status = session?.status ?? instance.status;

  return {
    instanceId,
    status,
    phone: session?.connectedPhone ?? instance.phone,
    connectedAt: instance.lastConnectedAt?.toISOString() ?? null,
    lastSyncAt: instance.lastSyncAt?.toISOString() ?? null,
    requiresQr: status === "qr" && Boolean(session?.qrCode),
    lastErrorCode: session?.lastError ? "WHATSAPP_OPERATION_FAILED" : null,
    updatedAt: (session?.updatedAt ?? instance.updatedAt).toISOString()
  };
}

export async function getInternalInstanceQr(instanceId: string) {
  await requireInternalInstance(instanceId);
  const session = await prisma.whatsappSession.findFirst({
    where: { instanceId },
    orderBy: { updatedAt: "desc" },
    select: { qrCode: true, status: true, updatedAt: true }
  });

  const isDataUrl = Boolean(session?.qrCode?.startsWith("data:image/"));
  const isStale = Boolean(session && Date.now() - session.updatedAt.getTime() > 180_000);
  if (!session?.qrCode || session.status !== "qr" || !isDataUrl || isStale) {
    throw new InternalApiError("QR_NOT_AVAILABLE", "QR Code não disponível", 404);
  }

  const updatedAt = session.updatedAt;
  return {
    instanceId,
    qrCode: session.qrCode,
    updatedAt: updatedAt.toISOString(),
    expiresAt: new Date(updatedAt.getTime() + 180_000).toISOString(),
    expiresAtHeuristic: true
  };
}

export async function connectInternalInstance(
  instanceId: string,
  mode: "auto" | "resume" | "new_qr"
) {
  const instance = await requireInternalInstance(instanceId);
  const session = await prisma.whatsappSession.findFirst({
    where: { instanceId },
    orderBy: { updatedAt: "desc" }
  });
  const hasConfirmedSession = Boolean(
    instance.phone ||
      instance.status === WhatsappStatus.connected ||
      session?.connectedPhone ||
      session?.status === WhatsappStatus.connected
  );

  if (instance.status === WhatsappStatus.connected || session?.status === WhatsappStatus.connected) {
    return { instanceId, status: "connected", enqueued: false, jobId: null };
  }
  if (mode === "new_qr" && hasConfirmedSession) {
    throw new InternalApiError(
      "INSTANCE_STATE_CONFLICT",
      "A sessão confirmada não pode ser substituída por este endpoint",
      409
    );
  }
  if (mode === "resume" && !hasConfirmedSession) {
    throw new InternalApiError(
      "INSTANCE_STATE_CONFLICT",
      "Não existe sessão confirmada para retomar",
      409
    );
  }

  const job = await enqueueWhatsappConnect(instanceId);
  return {
    instanceId,
    status: "connecting",
    enqueued: !job.deduped,
    jobId: job.jobId
  };
}

export async function syncInternalInstance(
  instanceId: string,
  scope: "quick" | "catalog" | "history"
) {
  const instance = await requireInternalInstance(instanceId);
  const session = await prisma.whatsappSession.findFirst({
    where: { instanceId },
    orderBy: { updatedAt: "desc" },
    select: { status: true, connectedPhone: true }
  });
  const canSync = Boolean(
    instance.phone ||
      session?.connectedPhone ||
      instance.status === WhatsappStatus.connected ||
      session?.status === WhatsappStatus.connected
  );
  if (!canSync) {
    throw new InternalApiError(
      "INSTANCE_STATE_CONFLICT",
      "Instância não está pronta para sincronização",
      409
    );
  }

  const job =
    scope === "history"
      ? await enqueueWhatsappHistorySync(instanceId)
      : await enqueueWhatsappCatalogSync({
          instanceId,
          forceSnapshot: scope === "catalog"
        });
  return { instanceId, scope, jobId: job.jobId, deduped: job.deduped };
}

export async function disconnectInternalInstance(instanceId: string) {
  const instance = await requireInternalInstance(instanceId);
  const session = await prisma.whatsappSession.findFirst({
    where: { instanceId },
    orderBy: { updatedAt: "desc" },
    select: { status: true }
  });
  if (
    instance.status === WhatsappStatus.disconnected &&
    (!session || session.status === WhatsappStatus.disconnected)
  ) {
    return { instanceId, status: "disconnected", enqueued: false, jobId: null };
  }
  const job = await enqueueWhatsappPreserveDisconnect(instanceId);
  return {
    instanceId,
    status: "disconnecting",
    enqueued: !job.deduped,
    jobId: job.jobId
  };
}

export async function listInternalLabels(instanceId: string) {
  await requireInternalInstance(instanceId);
  const labels = await prisma.whatsappLabel.findMany({
    where: { instanceId, deleted: false },
    orderBy: { name: "asc" },
    select: {
      waLabelId: true,
      name: true,
      color: true,
      predefined: true,
      updatedAt: true
    }
  });
  return labels.map((label) => ({
    ...label,
    updatedAt: label.updatedAt.toISOString()
  }));
}

export async function requireInternalChat(instanceId: string, chatId: string) {
  const chat = await prisma.whatsappChat.findFirst({
    where: { id: chatId, instanceId },
    select: { id: true, jid: true }
  });
  if (!chat) {
    throw new InternalApiError("CHAT_NOT_FOUND", "Chat não encontrado", 404);
  }
  return chat;
}

export async function listInternalChatLabels(instanceId: string, chatId: string) {
  await requireInternalChat(instanceId, chatId);
  return prisma.whatsappChatLabel.findMany({
    where: { instanceId, chatId },
    orderBy: { label: { name: "asc" } },
    select: {
      label: {
        select: {
          waLabelId: true,
          name: true,
          color: true,
          predefined: true
        }
      }
    }
  }).then((rows) => rows.map((row) => row.label));
}

async function assertMutableChatJid(instanceId: string, jid: string) {
  const type = classifyJid(jid);
  if (type === "lid") {
    const mapping = await prisma.whatsappContact.findFirst({
      where: {
        instanceId,
        jid,
        phone: { not: null }
      },
      select: { id: true }
    });
    if (!mapping) {
      throw new InternalApiError("LID_UNRESOLVED", "LID sem telefone resolvido", 422);
    }
    return;
  }
  if (type !== "individual_phone") {
    throw new InternalApiError("UNSUPPORTED_JID", "JID não suportado", 422);
  }
}

export async function mutateInternalChatLabel(options: {
  instanceId: string;
  chatId: string;
  waLabelId: string;
  operation: "apply" | "remove";
  correlationKey?: string;
}) {
  const chat = await requireInternalChat(options.instanceId, options.chatId);
  await assertMutableChatJid(options.instanceId, chat.jid);
  const label = await prisma.whatsappLabel.findFirst({
    where: {
      instanceId: options.instanceId,
      waLabelId: options.waLabelId,
      deleted: false
    },
    select: { id: true, waLabelId: true }
  });
  if (!label) {
    throw new InternalApiError("LABEL_NOT_FOUND", "Etiqueta não encontrada", 404);
  }
  const existing = await prisma.whatsappChatLabel.findUnique({
    where: {
      instanceId_chatId_labelId: {
        instanceId: options.instanceId,
        chatId: chat.id,
        labelId: label.id
      }
    },
    select: { id: true }
  });

  if ((options.operation === "apply" && existing) || (options.operation === "remove" && !existing)) {
    return { changed: false, enqueued: false, jobId: null };
  }

  const job = await enqueueMutateWhatsappChatLabel({
    instanceId: options.instanceId,
    operation: options.operation,
    chatId: chat.id,
    labelId: label.id,
    waLabelId: label.waLabelId,
    jid: chat.jid,
    correlationKey: options.correlationKey
  });
  return { changed: true, enqueued: !job.deduped, jobId: job.jobId };
}

export async function findInternalContactByPhone(instanceId: string, phoneNormalized: string) {
  await requireInternalInstance(instanceId);
  const candidatePhones = brazilianPhoneAliases(phoneNormalized);
  const jids = candidatePhones.flatMap(phoneJids);
  const lidJids = candidatePhones.map((phone) => `${phone}@lid`);
  const [crmContacts, whatsappContacts, identities] = await Promise.all([
    prisma.contact.findMany({
      where: { instanceId, phoneNormalized: { in: candidatePhones } },
      select: { id: true, name: true, phoneNormalized: true }
    }),
    prisma.whatsappContact.findMany({
      where: {
        instanceId,
        OR: [
          { phone: { in: candidatePhones } },
          { jid: { in: [...jids, ...lidJids] } }
        ]
      },
      select: { id: true, name: true, pushName: true, jid: true, phone: true },
      take: 10
    }),
    prisma.whatsappIdentity?.findMany({
      where: { instanceId, phoneNormalized: { in: candidatePhones }, confidence: "DETERMINISTIC" },
      select: { lidJid: true, phoneNormalized: true },
      take: 10
    }) ?? Promise.resolve([])
  ]);
  const mappedLidJids = whatsappContacts
    .filter((contact) => contact.phone && contact.jid.endsWith("@lid"))
    .map((contact) => contact.jid)
    .concat(identities.map((identity) => identity.lidJid));
  const chats = await prisma.whatsappChat.findMany({
    where: { instanceId, jid: { in: [...jids, ...lidJids, ...mappedLidJids] } },
    select: {
      id: true,
      jid: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      labels: {
        select: {
          label: {
            select: { waLabelId: true, name: true, color: true }
          }
        }
      }
    },
    take: 10
  });

  const resolvedPhone = chooseResolvedPhone(phoneNormalized, [
    ...crmContacts.map((contact) => contact.phoneNormalized),
    ...whatsappContacts.flatMap((contact) => {
      const jidPhone = phoneFromIndividualJid(contact.jid);
      return [contact.phone, jidPhone].filter((phone): phone is string => Boolean(phone));
    }),
    ...chats.map((chat) => phoneFromIndividualJid(chat.jid)).filter(
      (phone): phone is string => Boolean(phone)
    ),
    ...identities.map((identity) => identity.phoneNormalized).filter(
      (phone): phone is string => Boolean(phone)
    )
  ]);
  if (resolvedPhone === "AMBIGUOUS") {
    throw new InternalApiError("CONTACT_AMBIGUOUS", "Contato ambíguo", 409);
  }
  if (!resolvedPhone) {
    if (
      whatsappContacts.some((contact) => contact.jid.endsWith("@lid")) ||
      chats.some((chat) => chat.jid.endsWith("@lid"))
    ) {
      throw new InternalApiError("LID_UNRESOLVED", "LID sem telefone resolvido", 422);
    }
    throw new InternalApiError("CONTACT_NOT_FOUND", "Contato não encontrado", 404);
  }
  const matchingContactJids = new Set(
    whatsappContacts
      .filter((contact) =>
        contact.phone === resolvedPhone ||
        phoneFromIndividualJid(contact.jid) === resolvedPhone
      )
      .map((contact) => contact.jid)
  );
  const matchingChatJids = new Set(
    chats
      .filter((candidate) => phoneFromIndividualJid(candidate.jid) === resolvedPhone)
      .map((candidate) => candidate.jid)
  );
  if (matchingContactJids.size > 1 || matchingChatJids.size > 1) {
    throw new InternalApiError("CONTACT_AMBIGUOUS", "Contato ambíguo", 409);
  }
  const crmContact =
    crmContacts.find((contact) => contact.phoneNormalized === resolvedPhone) ?? null;
  const whatsappContact =
    whatsappContacts.find((contact) =>
      contact.phone === resolvedPhone ||
      phoneFromIndividualJid(contact.jid) === resolvedPhone
    ) ?? null;
  const identity = identities.find((candidate) => candidate.phoneNormalized === resolvedPhone) ?? null;
  const chat =
    chats.find((candidate) =>
      phoneFromIndividualJid(candidate.jid) === resolvedPhone ||
      (whatsappContact?.jid === candidate.jid && candidate.jid.endsWith("@lid")) ||
      identity?.lidJid === candidate.jid
    ) ?? null;
  const responseJid = whatsappContact?.jid.endsWith("@lid")
    ? phoneJids(resolvedPhone)[0]
    : whatsappContact?.jid ?? chat?.jid ?? phoneJids(resolvedPhone)[0];

  return {
    contact: {
      id: whatsappContact?.id ?? crmContact?.id ?? chat?.id ?? null,
      phoneNormalized,
      name: whatsappContact?.name ?? whatsappContact?.pushName ?? crmContact?.name ?? null,
      jid: responseJid
    },
    chat: chat
      ? {
          id: chat.id,
          jid: chat.jid,
          lastInboundAt: chat.lastInboundAt?.toISOString() ?? null,
          lastOutboundAt: chat.lastOutboundAt?.toISOString() ?? null
        }
      : null,
    labels: chat?.labels.map((row) => row.label) ?? [],
    resolution: identity && chat?.jid === identity.lidJid
      ? "LID_HISTORICAL"
      : resolvedPhone === phoneNormalized ? "EXACT" : "ALIAS",
    labeledCrm: Boolean(chat?.labels.some((row) => /^CRM (?:0[1-5]|99)(?:\b|\s|-)/.test(row.label.name)))
  };
}

export async function rebuildInternalIdentities(instanceId: string, phones: string[] = []) {
  await requireInternalInstance(instanceId);
  const job = await enqueueWhatsappIdentityRebuild(instanceId, phones);
  return { instanceId, jobId: job.jobId, deduped: job.deduped };
}

export async function getInternalIdentityRebuildStatus(instanceId: string) {
  await requireInternalInstance(instanceId);
  return getWhatsappIdentityRebuildStatus(instanceId);
}

export async function getInternalIdentityDiagnostics(instanceId: string) {
  await requireInternalInstance(instanceId);
  return getIdentityDiagnostics(instanceId);
}

export async function listInternalLabeledIdentities(instanceId: string) {
  await requireInternalInstance(instanceId);
  const official = [
    "CRM 01 - Em atendimento", "CRM 02 - Qualificado",
    "CRM 03 - Inscrição no vestibular", "CRM 04 - Vestibular concluído",
    "CRM 05 - Matriculado", "CRM 99 - Perdido"
  ];
  const chats = await prisma.whatsappChat.findMany({
    where: { instanceId, isGroup: false,
      labels: { some: { label: { deleted: false, name: { in: official } } } } },
    select: {
      id: true, jid: true,
      labels: { where: { label: { deleted: false, name: { in: official } } },
        select: { label: { select: { waLabelId: true, name: true } } } }
    }
  });
  const lidJids = chats.filter((chat) => chat.jid.endsWith("@lid")).map((chat) => chat.jid);
  const identities = lidJids.length ? await prisma.whatsappIdentity.findMany({
    where: { instanceId, lidJid: { in: lidJids }, confidence: "DETERMINISTIC" },
    select: { lidJid: true, phoneNormalized: true }
  }) : [];
  const byLid = Object.fromEntries(
    identities.map((identity) => [identity.lidJid, identity.phoneNormalized])
  );
  return chats.map((chat) => ({
    chatId: chat.id,
    phoneNormalized: phoneFromIndividualJid(chat.jid) ?? byLid[chat.jid] ?? null,
    resolution: chat.jid.endsWith("@lid")
      ? Object.hasOwn(byLid, chat.jid) ? "LID_HISTORICAL" : "LID_UNRESOLVED"
      : "PN",
    labels: chat.labels.map((row) => row.label)
  }));
}
