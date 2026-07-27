import { Worker } from "bullmq";
import { CampaignRecipientStatus, CampaignStatus, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma/client";
import {
  CAMPAIGN_QUEUE_NAME,
  APPLY_WHATSAPP_LABELS_JOB,
  CONNECT_WHATSAPP_JOB,
  DISCONNECT_WHATSAPP_JOB,
  MUTATE_WHATSAPP_CHAT_LABEL_JOB,
  PRESERVE_DISCONNECT_WHATSAPP_JOB,
  RESET_WHATSAPP_JOB,
  SEND_MANUAL_MESSAGE_JOB,
  SEND_RECIPIENT_JOB,
  SYNC_WHATSAPP_CATALOG_JOB,
  SYNC_WHATSAPP_HISTORY_JOB,
  closeCampaignQueue,
  type ApplyWhatsappLabelsJobData,
  type MutateWhatsappChatLabelJobData,
  type SendManualMessageJobData,
  type SyncWhatsappCatalogJobData
} from "../lib/queue/campaign-queue";
import { getRedisConnectionOptions } from "../lib/queue/connection";
import {
  isBaileysStartSkippedError,
  markWhatsappError
} from "../lib/baileys/client";
import {
  applyWhatsappLabelsForInstance,
  disconnectWhatsappInstance,
  getWhatsappInstanceRuntimeStatus,
  mutateWhatsappChatLabelForInstance,
  reconnectWhatsappInstance,
  requestWhatsappCatalogSyncForInstance,
  requestWhatsappHistorySyncForInstance,
  resetWhatsappInstance,
  sendWhatsappContentForInstance,
  sendWhatsappMessageForInstance,
  WhatsappInstanceUnavailableError
} from "../lib/baileys/instance-manager";
import { ensureChatForJid, isGroupJid, normalizeChatJid } from "../lib/baileys/sync";
import { completeCampaignIfDone } from "../lib/campaigns/progress";
import { CampaignMediaError, loadValidatedCampaignMedia } from "../lib/campaigns/media";
import { schedulePendingRecipients } from "../lib/campaigns/schedule";
import { startCampaignScheduler } from "../lib/campaigns/scheduler";
import { getDispatchDay, nextDispatchDecision, resolveDispatchSettings } from "../lib/campaigns/dispatch-policy";
import {
  isSerializableTransactionConflict,
  MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS
} from "../lib/campaigns/transaction-conflict";
import { hashMessage, resolveCampaignJid, type SkippedReason } from "../lib/labels/audience";
import {
  clearPendingInternalLabelMutation,
  recordLabelAssociationChange,
  registerPendingInternalLabelMutation,
  type LabelEventOperation
} from "../lib/labels/label-events";
import { normalizeBrazilPhone, toWhatsappJid } from "../lib/phone/normalize";
import { clearWhatsappOperationalData } from "../lib/server/whatsapp-session-data";
import { DEFAULT_WHATSAPP_INSTANCE_ID } from "../lib/server/whatsapp-instances";
import { shouldIgnoreJidForX1Only } from "../lib/whatsapp/jid";
import {
  createHeartbeatRedis,
  recordWorkerHeartbeat,
  recordWorkerReadiness,
  removeWorkerReadiness
} from "./heartbeat";
import { withTimeout } from "./timeout";

const finalRecipientStatuses: CampaignRecipientStatus[] = [
  CampaignRecipientStatus.sent,
  CampaignRecipientStatus.failed,
  CampaignRecipientStatus.canceled
];
const HEARTBEAT_INITIALIZATION_TIMEOUT_MS = 5_000;
const BULLMQ_READINESS_TIMEOUT_MS = 10_000;
const RESOURCE_CLOSE_TIMEOUT_MS = 2_000;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

function getRequiredJobInstanceId(data: unknown, jobName: string) {
  const instanceId = String((data as { instanceId?: string } | undefined)?.instanceId ?? "").trim();

  if (!instanceId) {
    throw new Error(`${jobName} sem instanceId`);
  }

  return instanceId;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canResumeForSync(status: Awaited<ReturnType<typeof getWhatsappInstanceRuntimeStatus>>) {
  return Boolean(
    status.status === "connected" ||
    status.connectedPhone ||
    status.hasRegisteredSession ||
    status.hasMeId ||
    status.isRecoverableSession
  );
}

async function ensureWhatsappReadyForSync(instanceId: string, syncType: string, jobId: string | undefined) {
  const before = await getWhatsappInstanceRuntimeStatus(instanceId);

  console.log("[worker] sync socket check", {
    action: "sync_socket_check",
    instanceId,
    syncType,
    jobId,
    socketStatusBefore: before.status,
    hasRegisteredSession: before.hasRegisteredSession ?? false,
    hasMeId: before.hasMeId ?? false,
    isPairingPartial: before.isPairingPartial ?? false
  });

  if (!canResumeForSync(before)) {
    throw new Error("Conecte esta instancia antes de sincronizar.");
  }

  if (before.status !== "connected") {
    try {
      await reconnectWhatsappInstance(instanceId);
    } catch (error) {
      if (!isBaileysStartSkippedError(error)) {
        throw error;
      }
    }
  }

  const deadline = Date.now() + 20_000;
  let after = await getWhatsappInstanceRuntimeStatus(instanceId);

  while (after.status === "connecting" && Date.now() < deadline) {
    await sleep(500);
    after = await getWhatsappInstanceRuntimeStatus(instanceId);
  }

  console.log("[worker] sync socket ready check finished", {
    action: "sync_socket_ready_check",
    instanceId,
    syncType,
    jobId,
    socketStatusBefore: before.status,
    socketStatusAfter: after.status
  });

  if (after.status !== "connected") {
    throw new Error(`WhatsApp nao conectado para sincronizacao: ${after.status}`);
  }
}

type SentWhatsappMessage = Awaited<ReturnType<typeof sendWhatsappContentForInstance>>;

function buildFallbackMessageId(prefix: string, id: string | undefined) {
  return `${prefix}-${id ?? Date.now()}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 180);
}

async function persistOutboundMessage(options: {
  instanceId: string;
  jid: string;
  text: string;
  sentAt: Date;
  sentMessage: SentWhatsappMessage;
  fallbackMessageId: string;
  messageType?: string;
}) {
  const normalizedJid = normalizeChatJid(options.jid);

  if (!normalizedJid) {
    throw new Error("JID invalido para persistir mensagem enviada");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("JID ignorado pelo modo de envio individual");
  }

  const scopedChat = await ensureChatForJid(normalizedJid, undefined, options.instanceId);
  const waMessageId = options.sentMessage.waMessageId ?? options.fallbackMessageId;

  await prisma.whatsappMessage.upsert({
    where: {
      instanceId_jid_waMessageId: {
        instanceId: options.instanceId,
        jid: normalizedJid,
        waMessageId
      }
    },
    update: {
      chatId: scopedChat.id,
      fromMe: true,
      senderJid: options.sentMessage.senderJid,
      timestamp: options.sentAt,
      messageType: options.messageType ?? "text",
      text: options.text,
      rawJson: options.sentMessage.rawJson
    },
    create: {
      chatId: scopedChat.id,
      instanceId: options.instanceId,
      jid: normalizedJid,
      waMessageId,
      fromMe: true,
      senderJid: options.sentMessage.senderJid,
      timestamp: options.sentAt,
      messageType: options.messageType ?? "text",
      text: options.text,
      rawJson: options.sentMessage.rawJson
    }
  });

  await prisma.whatsappChat.update({
    where: {
      id: scopedChat.id
    },
    data: {
      isGroup: isGroupJid(normalizedJid),
      lastMessageAt: options.sentAt,
      lastMessageText: options.text,
      lastOutboundAt: options.sentAt
    }
  });

  return scopedChat.id;
}

function getPhoneFromRecipientJid(jid: string | null | undefined) {
  if (!jid?.endsWith("@s.whatsapp.net")) {
    return null;
  }

  const phone = jid.split("@")[0]?.split(":")[0] ?? "";
  const normalized = normalizeBrazilPhone(phone);
  return normalized.ok ? normalized.normalized : null;
}

async function isRecipientOptedOut(
  recipient: {
    instanceId: string;
    jid: string | null;
    contact: { optedOut: boolean; phoneNormalized: string } | null;
  },
  resolvedJid?: string | null
) {
  if (recipient.contact?.optedOut) {
    return true;
  }

  const phone = getPhoneFromRecipientJid(recipient.jid ?? resolvedJid);

  if (!phone) {
    return false;
  }

  const contact = await prisma.contact.findFirst({
    where: {
      instanceId: recipient.instanceId,
      phoneNormalized: phone
    },
    select: {
      optedOut: true
    }
  });

  return Boolean(contact?.optedOut);
}

function getSkippedRecipientError(reason: SkippedReason) {
  if (reason === "group_excluded") {
    return "Grupo ignorado pelo modo de envio individual";
  }

  if (reason === "unresolved_chat") {
    return "Conversa sem JID resolvido para envio";
  }

  if (reason === "broadcast_or_status") {
    return "JID de broadcast/status ignorado";
  }

  return "JID invalido para envio";
}

async function resolveRecipientSendJid(recipient: {
  instanceId: string;
  jid: string | null;
  chatId: string | null;
}) {
  if (recipient.jid) {
    return resolveCampaignJid([recipient.jid]);
  }

  if (!recipient.chatId) {
    return resolveCampaignJid([]);
  }

  const chat = await prisma.whatsappChat.findFirst({
    where: {
      id: recipient.chatId,
      instanceId: recipient.instanceId
    },
    select: {
      jid: true
    }
  });

  return resolveCampaignJid([chat?.jid, recipient.chatId]);
}

async function processManualMessage(
  data: Partial<SendManualMessageJobData>,
  jobId: string | undefined
) {
  const chatId = String(data.chatId ?? "").trim();
  const normalizedJid = normalizeChatJid(data.jid);
  const text = String(data.text ?? "").trim();
  const requestedInstanceId = String(data.instanceId ?? "").trim();

  if (!chatId) {
    throw new Error("chatId obrigatorio para envio manual");
  }

  if (!normalizedJid) {
    throw new Error("JID invalido para envio manual");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("Envio manual para grupo ignorado pelo modo de envio individual");
  }

  if (!text) {
    throw new Error("Mensagem manual vazia");
  }

  if (text.length > 4000) {
    throw new Error("Mensagem manual excede 4000 caracteres");
  }

  const chat = await prisma.whatsappChat.findUnique({
    where: {
      id: chatId
    }
  });

  if (!chat) {
    throw new Error("Conversa nao encontrada para envio manual");
  }

  if (requestedInstanceId && requestedInstanceId !== chat.instanceId) {
    throw new Error("Instancia do job nao corresponde a conversa");
  }

  if (chat.jid !== normalizedJid) {
    throw new Error("JID do job nao corresponde a conversa");
  }

  try {
    console.log("[manual-send] sending with instance", {
      chatId,
      instanceId: chat.instanceId
    });
    const sentMessage = await sendWhatsappMessageForInstance(chat.instanceId, normalizedJid, text);
    const sentAt = new Date();
    await persistOutboundMessage({
      instanceId: chat.instanceId,
      jid: normalizedJid,
      text,
      sentAt,
      sentMessage,
      fallbackMessageId: buildFallbackMessageId("manual", jobId)
    });

    console.log("[worker] manual message sent", {
      chatId,
      jidType: isGroupJid(normalizedJid) ? "group" : "contact"
    });
  } catch (error) {
    console.error("[worker] manual message failed", {
      chatId,
      jidType: isGroupJid(normalizedJid) ? "group" : "contact",
      error: getErrorMessage(error)
    });
    throw error;
  }
}

async function buildCampaignMessageContent(campaign: {
  mediaKind: string | null;
  mediaPath: string | null;
  mediaOriginalName: string | null;
  mediaMimeType: string | null;
  mediaSizeBytes: number | null;
}, messageFinal: string) {
  const media = await loadValidatedCampaignMedia(campaign);

  if (!media) {
    return {
      content: { text: messageFinal },
      messageType: "text"
    } as const;
  }

  if (media.kind === "IMAGE") {
    return {
      content: {
        image: media.buffer,
        caption: messageFinal,
        mimetype: media.mimetype
      },
      messageType: "image"
    } as const;
  }

  if (media.kind === "VIDEO") {
    return {
      content: {
        video: media.buffer,
        caption: messageFinal,
        mimetype: media.mimetype
      },
      messageType: "video"
    } as const;
  }

  return {
    content: {
      document: media.buffer,
      caption: messageFinal,
      mimetype: media.mimetype,
      fileName: media.fileName
    },
    messageType: "document"
  } as const;
}

async function confirmRecipientStillAuthorized(recipient: {
  id: string;
  instanceId: string;
  campaignId: string;
}) {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: recipient.campaignId,
      instanceId: recipient.instanceId
    },
    select: {
      status: true,
      sendWindowStart: true,
      dispatchConfig: true
    }
  });

  if (campaign?.status === CampaignStatus.running) {
    const settings = resolveDispatchSettings(campaign.dispatchConfig, campaign.sendWindowStart);
    if (Number.isInteger(settings.dailyLimit) && Number(settings.dailyLimit) > 0) {
      const now = new Date();
      const day = getDispatchDay(now, settings);
      const sentToday = await prisma.campaignRecipient.count({
        where: {
          instanceId: recipient.instanceId,
          campaignId: recipient.campaignId,
          status: CampaignRecipientStatus.sent,
          sentAt: { gte: day.dayStart, lt: day.dayEnd }
        }
      });
      const outsideWindow = now < day.windowStart || now > day.windowEnd;
      if (outsideWindow || sentToday >= Number(settings.dailyLimit)) {
        const decision = nextDispatchDecision({
          now,
          settings,
          sentToday,
          hasPending: true,
          fallbackDelayMs: 0
        });
        await prisma.$transaction([
          prisma.campaignRecipient.updateMany({
            where: {
              id: recipient.id,
              instanceId: recipient.instanceId,
              status: CampaignRecipientStatus.sending
            },
            data: {
              status: CampaignRecipientStatus.scheduled,
              scheduledAt: decision.nextAt ?? now
            }
          }),
          prisma.campaign.updateMany({
            where: { id: recipient.campaignId, instanceId: recipient.instanceId, status: CampaignStatus.running },
            data: decision.pauseCampaign
              ? { status: CampaignStatus.paused, nextDispatchAt: null, lastError: "Campanha pausada ao final da janela diaria" }
              : { nextDispatchAt: decision.nextAt }
          })
        ]);
        return false;
      }
    }

    const claimedRecipient = await prisma.campaignRecipient.findFirst({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        campaignId: recipient.campaignId,
        status: CampaignRecipientStatus.sending
      },
      select: {
        id: true
      }
    });

    return Boolean(claimedRecipient);
  }

  if (campaign?.status === CampaignStatus.paused) {
    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: CampaignRecipientStatus.sending
      },
      data: {
        status: CampaignRecipientStatus.scheduled,
        scheduledAt: new Date()
      }
    });
  } else if (campaign?.status === CampaignStatus.canceled) {
    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: CampaignRecipientStatus.sending
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Campanha cancelada"
      }
    });
  }

  return false;
}

async function processRecipient(recipientId: string) {
  const recipient = await prisma.campaignRecipient.findUnique({
    where: {
      id: recipientId
    },
    include: {
      campaign: true,
      contact: true
    }
  });

  if (!recipient) {
    return;
  }

  if (finalRecipientStatuses.includes(recipient.status)) {
    return;
  }

  if (recipient.campaign.status === CampaignStatus.canceled) {
    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: {
          in: [CampaignRecipientStatus.pending, CampaignRecipientStatus.scheduled]
        }
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Campanha cancelada"
      }
    });
    return;
  }

  if (recipient.campaign.status !== CampaignStatus.running) {
    return;
  }

  if (recipient.scheduledAt && recipient.scheduledAt.getTime() > Date.now()) {
    return;
  }

  let resolvedRecipientJid: string | null = null;

  if (recipient.jid || recipient.chatId || !recipient.contact) {
    const resolvedJid = await resolveRecipientSendJid(recipient);
    const skipReason =
      !resolvedJid.ok
        ? resolvedJid.reason
        : resolvedJid.isGroup || shouldIgnoreJidForX1Only(resolvedJid.jid)
          ? "group_excluded"
          : null;

    if (skipReason) {
      await prisma.campaignRecipient.updateMany({
        where: {
          id: recipient.id,
          instanceId: recipient.instanceId,
          status: CampaignRecipientStatus.scheduled
        },
        data: {
          status: CampaignRecipientStatus.canceled,
          jid: resolvedJid.ok ? resolvedJid.jid : recipient.jid,
          error: getSkippedRecipientError(skipReason),
          skippedReason: skipReason
        }
      });
      console.log("[campaign] recipient skipped", { reason: skipReason });
      await schedulePendingRecipients(recipient.campaignId);
      return;
    }

    if (resolvedJid.ok) {
      resolvedRecipientJid = resolvedJid.jid;
    }
  }

  if (await isRecipientOptedOut(recipient, resolvedRecipientJid)) {
    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: CampaignRecipientStatus.scheduled
      },
      data: {
        status: CampaignRecipientStatus.canceled,
        error: "Contato opt-out",
        skippedReason: "opt_out"
      }
    });
    await schedulePendingRecipients(recipient.campaignId);
    return;
  }

  let claimed: { count: number } | null = null;
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      claimed = await prisma.$transaction(async (transaction) => {
        const now = new Date();
        const sendingCount = await transaction.campaignRecipient.count({
          where: {
            instanceId: recipient.instanceId,
            campaignId: recipient.campaignId,
            status: CampaignRecipientStatus.sending
          }
        });
        if (sendingCount > 0) return { count: 0 };

        const settings = resolveDispatchSettings(recipient.campaign.dispatchConfig, recipient.campaign.sendWindowStart);
        if (Number.isInteger(settings.dailyLimit) && Number(settings.dailyLimit) > 0) {
          const day = getDispatchDay(now, settings);
          const sentToday = await transaction.campaignRecipient.count({
            where: {
              instanceId: recipient.instanceId,
              campaignId: recipient.campaignId,
              status: CampaignRecipientStatus.sent,
              sentAt: { gte: day.dayStart, lt: day.dayEnd }
            }
          });
          if (sentToday >= Number(settings.dailyLimit)) return { count: 0 };
        }

        return transaction.campaignRecipient.updateMany({
          where: {
            id: recipient.id,
            instanceId: recipient.instanceId,
            campaignId: recipient.campaignId,
            status: CampaignRecipientStatus.scheduled,
            OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }]
          },
          data: {
            status: CampaignRecipientStatus.sending,
            error: null,
            attemptCount: { increment: 1 },
            lastAttemptAt: now
          }
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (
        !isSerializableTransactionConflict(error) ||
        attempt === MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }
    }
  }

  if (claimed?.count !== 1) {
    return;
  }

  let outbound: Awaited<ReturnType<typeof buildCampaignMessageContent>>;

  try {
    outbound = await buildCampaignMessageContent(
      recipient.campaign,
      recipient.messageFinal
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro ao preparar envio";

    if (error instanceof CampaignMediaError) {
      await prisma.$transaction([
        prisma.campaign.updateMany({
          where: {
            id: recipient.campaignId,
            instanceId: recipient.instanceId,
            status: CampaignStatus.running
          },
          data: {
            status: CampaignStatus.paused,
            lastError: errorMessage
          }
        }),
        prisma.campaignRecipient.updateMany({
          where: {
            id: recipient.id,
            instanceId: recipient.instanceId,
            status: CampaignRecipientStatus.sending
          },
          data: {
            status: CampaignRecipientStatus.scheduled,
            scheduledAt: new Date(),
            error: null
          }
        })
      ]);
      console.error("[campaign] media preparation paused campaign", {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        error: errorMessage
      });
      return;
    }

    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: CampaignRecipientStatus.sending
      },
      data: {
        status: CampaignRecipientStatus.failed,
        jid: resolvedRecipientJid ? resolvedRecipientJid : recipient.jid,
        error: errorMessage
      }
    });
    console.error("[worker] campaign preparation failed", {
      recipientId: recipient.id,
      campaignId: recipient.campaignId,
      error: errorMessage
    });
    await completeCampaignIfDone(recipient.campaignId);
    await schedulePendingRecipients(
      recipient.campaignId,
      recipient.campaign.intervalMinutes * 60 * 1000
    );
    return;
  }

  if (!(await confirmRecipientStillAuthorized(recipient))) {
    return;
  }

  let sentMessage: SentWhatsappMessage;
  let sentJid: string;

  try {

    if (resolvedRecipientJid) {
      sentJid = resolvedRecipientJid;
      console.log("[campaign] sending with instance", {
        campaignId: recipient.campaignId,
        instanceId: recipient.campaign.instanceId
      });
      sentMessage = await sendWhatsappContentForInstance(
        recipient.campaign.instanceId,
        resolvedRecipientJid,
        outbound.content
      );
    } else if (recipient.contact) {
      sentJid = toWhatsappJid(recipient.contact.phoneNormalized);
      console.log("[campaign] sending with instance", {
        campaignId: recipient.campaignId,
        instanceId: recipient.campaign.instanceId
      });
      sentMessage = await sendWhatsappContentForInstance(
        recipient.campaign.instanceId,
        sentJid,
        outbound.content
      );
    } else {
      throw new Error("Destinatario sem jid ou contato");
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro ao enviar mensagem";

    if (error instanceof WhatsappInstanceUnavailableError) {
      const pauseMessage =
        `Campanha pausada: ${errorMessage} Reconecte a instancia e retome a campanha.`;

      await prisma.$transaction([
        prisma.campaign.updateMany({
          where: {
            id: recipient.campaignId,
            instanceId: recipient.instanceId,
            status: CampaignStatus.running
          },
          data: {
            status: CampaignStatus.paused,
            lastError: pauseMessage
          }
        }),
        prisma.campaignRecipient.updateMany({
          where: {
            id: recipient.id,
            instanceId: recipient.instanceId,
            campaignId: recipient.campaignId,
            status: CampaignRecipientStatus.sending
          },
          data: {
            status: CampaignRecipientStatus.scheduled,
            scheduledAt: new Date(),
            error: null
          }
        })
      ]);

      console.error("[campaign] WhatsApp unavailable; campaign paused", {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        instanceId: recipient.instanceId,
        error: errorMessage
      });

      return;
    }

    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: CampaignRecipientStatus.sending
      },
      data: {
        status: CampaignRecipientStatus.failed,
        jid: resolvedRecipientJid ? resolvedRecipientJid : recipient.jid,
        error: errorMessage
      }
    });
    await prisma.campaign.update({
      where: {
        id: recipient.campaignId
      },
      data: {
        updatedAt: new Date()
      }
    }).catch(() => undefined);

    if (resolvedRecipientJid) {
      await prisma.sendLog.create({
        data: {
          instanceId: recipient.instanceId,
          jid: resolvedRecipientJid,
          chatId: recipient.chatId,
          campaignId: recipient.campaignId,
          recipientId: recipient.id,
          messageHash: hashMessage(recipient.messageFinal),
          status: "failed",
          error: errorMessage
        }
      }).catch(() => undefined);
    }

    console.error("[worker] campaign message failed", {
      recipientId: recipient.id,
      campaignId: recipient.campaignId,
      error: errorMessage
    });
    await completeCampaignIfDone(recipient.campaignId);
    await schedulePendingRecipients(
      recipient.campaignId,
      recipient.campaign.intervalMinutes * 60 * 1000
    );
    return;
  }

  const sentAt = new Date();
  let confirmedAsSent = false;

  try {
    const confirmed = await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: {
          in: [
            CampaignRecipientStatus.sending,
            CampaignRecipientStatus.scheduled,
            CampaignRecipientStatus.canceled
          ]
        }
      },
      data: {
        status: CampaignRecipientStatus.sent,
        sentAt,
        jid: resolvedRecipientJid ? sentJid : recipient.jid,
        error: null
      }
    });
    confirmedAsSent = confirmed.count === 1;

    if (!confirmedAsSent) {
      const current = await prisma.campaignRecipient.findUnique({
        where: { id: recipient.id },
        select: { status: true }
      });
      confirmedAsSent = current?.status === CampaignRecipientStatus.sent;
    }
  } catch (error) {
    console.error("[campaign] failed to persist confirmed WhatsApp send", {
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      error: error instanceof Error ? error.message : "Erro desconhecido"
    });
  }

  if (!confirmedAsSent) {
    const uncertaintyMessage =
      "CRITICO: o WhatsApp pode ter entregue a mensagem, mas o registro do envio nao foi confirmado. Destinatario bloqueado para analise manual.";
    await prisma.campaign.updateMany({
      where: {
        id: recipient.campaignId,
        instanceId: recipient.instanceId,
        status: CampaignStatus.running
      },
      data: {
        status: CampaignStatus.paused,
        lastError: uncertaintyMessage
      }
    }).catch((error) => {
      console.error("[campaign] failed to pause uncertain campaign", {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      });
    });
    console.error("[campaign] confirmed send has uncertain persistence", {
      campaignId: recipient.campaignId,
      recipientId: recipient.id
    });
    return;
  }

  let persistedChatId: string | null = null;
  try {
    persistedChatId = await persistOutboundMessage({
      instanceId: recipient.instanceId,
      jid: sentJid,
      text: recipient.messageFinal,
      sentAt,
      sentMessage,
      fallbackMessageId: buildFallbackMessageId("campaign", recipient.id),
      messageType: outbound.messageType
    });
  } catch (error) {
    console.error("[campaign] sent message history persistence failed", {
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
      error: error instanceof Error ? error.message : "Erro desconhecido"
    });
  }

  if (persistedChatId) {
    await prisma.campaignRecipient.updateMany({
      where: {
        id: recipient.id,
        instanceId: recipient.instanceId,
        status: CampaignRecipientStatus.sent
      },
      data: {
        chatId: recipient.chatId ?? persistedChatId
      }
    }).catch(() => undefined);
  }

  await prisma.campaign.update({
    where: { id: recipient.campaignId },
    data: { updatedAt: new Date() }
  }).catch(() => undefined);

  if (resolvedRecipientJid) {
    await prisma.sendLog.create({
      data: {
        instanceId: recipient.instanceId,
        jid: sentJid,
        chatId: recipient.chatId ?? persistedChatId,
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        messageHash: hashMessage(recipient.messageFinal),
        status: "sent",
        sentAt
      }
    }).catch((error) => {
      console.error("[campaign] sent message audit log failed", {
        campaignId: recipient.campaignId,
        recipientId: recipient.id,
        error: error instanceof Error ? error.message : "Erro desconhecido"
      });
    });
  }

  console.log("[worker] campaign message sent", {
    recipientId: recipient.id,
    campaignId: recipient.campaignId,
    jidType: resolvedRecipientJid
      ? isGroupJid(resolvedRecipientJid)
        ? "group"
        : "contact"
      : "contact-sheet"
  });

  await completeCampaignIfDone(recipient.campaignId);
  await schedulePendingRecipients(
    recipient.campaignId,
    recipient.campaign.intervalMinutes * 60 * 1000
  );
}

let cleanupRuntimeOnFatal: (() => Promise<void>) | null = null;

async function main() {
  const redisConnectionOptions = getRedisConnectionOptions();
  const heartbeatRedis = createHeartbeatRedis();
  heartbeatRedis.on("error", () => undefined);
  let runtimeWorker: Worker | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let readinessTimer: ReturnType<typeof setInterval> | null = null;
  let campaignScheduler: ReturnType<typeof startCampaignScheduler> | null = null;

  async function closeWorkerRuntimeResources(worker?: Worker) {
    await Promise.allSettled([
      worker?.close(),
      closeCampaignQueue(),
      withTimeout(
        removeWorkerReadiness(heartbeatRedis),
        RESOURCE_CLOSE_TIMEOUT_MS
      ),
      withTimeout(prisma.$disconnect(), RESOURCE_CLOSE_TIMEOUT_MS)
    ]);
    try {
      await withTimeout(heartbeatRedis.quit(), RESOURCE_CLOSE_TIMEOUT_MS);
    } catch {
      heartbeatRedis.disconnect();
    }
  }

  cleanupRuntimeOnFatal = async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (readinessTimer) clearInterval(readinessTimer);
    if (campaignScheduler) {
      await campaignScheduler.stop().catch(() => undefined);
    }
    await closeWorkerRuntimeResources(runtimeWorker);
  };

  try {
    await withTimeout(
      removeWorkerReadiness(heartbeatRedis),
      HEARTBEAT_INITIALIZATION_TIMEOUT_MS
    );
  } catch {
    console.error("WORKER_BULLMQ_READINESS_FAILED");
    await closeWorkerRuntimeResources();
    process.exit(1);
  }

  try {
    await withTimeout(
      recordWorkerHeartbeat(heartbeatRedis),
      HEARTBEAT_INITIALIZATION_TIMEOUT_MS
    );
  } catch {
    console.error("WORKER_HEARTBEAT_INITIALIZATION_FAILED");
    await closeWorkerRuntimeResources();
    process.exit(1);
  }

  heartbeatTimer = setInterval(() => {
    void withTimeout(
      recordWorkerHeartbeat(heartbeatRedis),
      HEARTBEAT_INITIALIZATION_TIMEOUT_MS
    ).catch(() => {
      console.error("WORKER_HEARTBEAT_PERIODIC_FAILED");
    });
  }, 15_000);
  heartbeatTimer.unref();
  console.log("[worker] heartbeat initialized");

  let worker: Worker;
  try {
    worker = new Worker(
  CAMPAIGN_QUEUE_NAME,
  async (job) => {
    console.log("[worker] job received", {
      name: job.name,
      id: job.id
    });

    if (job.name === CONNECT_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, CONNECT_WHATSAPP_JOB);
      console.log("[worker] connect-whatsapp job received", { instanceId });

      try {
        await reconnectWhatsappInstance(instanceId);
        console.log("[worker] connect-whatsapp finished", { instanceId });
      } catch (error) {
        if (isBaileysStartSkippedError(error)) {
          console.log("[worker] connect-whatsapp skipped", {
            reason: getErrorMessage(error)
          });
          return;
        }

        const lastError = `Falha ao iniciar conexao WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] connect-whatsapp failed", { instanceId, error: lastError });
        if (instanceId === DEFAULT_WHATSAPP_INSTANCE_ID) {
          await markWhatsappError(lastError);
        }
        throw error;
      }

      return;
    }

    if (job.name === DISCONNECT_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, DISCONNECT_WHATSAPP_JOB);
      console.log("[worker] disconnect-whatsapp job received", { instanceId });

      try {
        await clearWhatsappOperationalData("manual-disconnect-worker", instanceId);
        await disconnectWhatsappInstance(instanceId);
        console.log("[worker] disconnect-whatsapp finished", { instanceId });
      } catch (error) {
        const lastError = `Falha ao desconectar WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] disconnect-whatsapp failed", { instanceId, error: lastError });
        if (instanceId === DEFAULT_WHATSAPP_INSTANCE_ID) {
          await markWhatsappError(lastError);
        }
        throw error;
      }

      return;
    }

    if (job.name === PRESERVE_DISCONNECT_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, PRESERVE_DISCONNECT_WHATSAPP_JOB);
      await disconnectWhatsappInstance(instanceId);
      console.log("[worker] preserve-disconnect-whatsapp finished", { instanceId });
      return;
    }

    if (job.name === RESET_WHATSAPP_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, RESET_WHATSAPP_JOB);
      console.log("[worker] reset-whatsapp job received", { instanceId });

      try {
        await clearWhatsappOperationalData("manual-reset-worker", instanceId);
        await resetWhatsappInstance(instanceId);
        console.log("[worker] reset-whatsapp finished", { instanceId });
      } catch (error) {
        const lastError = `Falha ao resetar sessao WhatsApp no worker: ${getErrorMessage(error)}`;
        console.error("[worker] reset-whatsapp failed", { instanceId, error: lastError });
        if (instanceId === DEFAULT_WHATSAPP_INSTANCE_ID) {
          await markWhatsappError(lastError);
        }
        throw error;
      }

      return;
    }

    if (job.name === SYNC_WHATSAPP_HISTORY_JOB) {
      const instanceId = getRequiredJobInstanceId(job.data, SYNC_WHATSAPP_HISTORY_JOB);
      const startedAt = Date.now();
      console.log("[worker] sync-whatsapp-history job received", { instanceId, jobId: job.id });
      console.log("[worker] sync_started", { instanceId, syncType: "history", jobId: job.id });

      try {
        await ensureWhatsappReadyForSync(instanceId, "history", job.id);
        const result = await requestWhatsappHistorySyncForInstance(instanceId);
        console.log("[worker] sync_finished", {
          instanceId,
          syncType: "history",
          jobId: job.id,
          ok: result.ok,
          mode: result.mode,
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        console.error("[worker] sync_failed", {
          instanceId,
          syncType: "history",
          jobId: job.id,
          error: getErrorMessage(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }

      return;
    }

    if (job.name === SYNC_WHATSAPP_CATALOG_JOB) {
      const data = job.data as Partial<SyncWhatsappCatalogJobData>;
      const instanceId = getRequiredJobInstanceId(data, SYNC_WHATSAPP_CATALOG_JOB);
      const syncType = data.forceSnapshot === true ? "catalog-full" : "catalog-quick";
      const startedAt = Date.now();
      console.log("[worker] sync_started", { instanceId, syncType, jobId: job.id });

      try {
        await ensureWhatsappReadyForSync(instanceId, syncType, job.id);
        const result = await requestWhatsappCatalogSyncForInstance(instanceId, data);
        console.log("[worker] sync_finished", {
          instanceId,
          syncType,
          jobId: job.id,
          ok: result.ok,
          mode: result.mode,
          durationMs: Date.now() - startedAt
        });
      } catch (error) {
        console.error("[worker] sync_failed", {
          instanceId,
          syncType,
          jobId: job.id,
          error: getErrorMessage(error),
          durationMs: Date.now() - startedAt
        });
        throw error;
      }

      return;
    }

    if (job.name === APPLY_WHATSAPP_LABELS_JOB) {
      const data = job.data as Partial<ApplyWhatsappLabelsJobData>;
      const jids = Array.isArray(data.jids) ? data.jids : [];
      const waLabelId = String(data.waLabelId ?? "").trim();
      const instanceId = getRequiredJobInstanceId(data, APPLY_WHATSAPP_LABELS_JOB);

      console.log("[contacts-labels] apply requested", {
        instanceId,
        count: jids.length
      });

      if (!waLabelId || jids.length === 0) {
        console.log("[contacts-labels] skipped no chat", {
          count: jids.length
        });
        return;
      }

      const result = await applyWhatsappLabelsForInstance({
        instanceId,
        waLabelId,
        jids
      });

      console.log("[contacts-labels] apply finished", {
        ok: result.ok,
        applied: result.applied,
        skipped: result.skipped,
        failed: result.failed
      });

      return;
    }

    if (job.name === MUTATE_WHATSAPP_CHAT_LABEL_JOB) {
      const data = job.data as Partial<MutateWhatsappChatLabelJobData>;
      const instanceId = getRequiredJobInstanceId(data, MUTATE_WHATSAPP_CHAT_LABEL_JOB);
      if (data.operation !== "apply" && data.operation !== "remove") {
        throw new Error("mutate-whatsapp-chat-label possui operação inválida");
      }
      const operation = data.operation;
      const jid = String(data.jid ?? "").trim();
      const waLabelId = String(data.waLabelId ?? "").trim();
      const chatId = String(data.chatId ?? "").trim();
      const labelId = String(data.labelId ?? "").trim();
      const correlationKey = String(data.correlationKey ?? "").trim() || null;

      if (!jid || !waLabelId || !chatId || !labelId) {
        throw new Error("mutate-whatsapp-chat-label possui dados inválidos");
      }

      const eventOperation: LabelEventOperation =
        operation === "apply" ? "APPLY" : "REMOVE";
      const pendingMutation = {
        instanceId,
        jid,
        waLabelId,
        operation: eventOperation
      };
      registerPendingInternalLabelMutation({
        ...pendingMutation,
        correlationKey
      });

      try {
        await mutateWhatsappChatLabelForInstance({
          instanceId,
          operation,
          jid,
          waLabelId
        });
        await recordLabelAssociationChange({
          instanceId,
          chatId,
          labelId,
          waLabelId,
          jid,
          operation: eventOperation,
          source: "INTERNAL_API",
          correlationKey
        });
      } finally {
        clearPendingInternalLabelMutation(pendingMutation);
      }

      console.log("[worker] mutate-whatsapp-chat-label finished", {
        instanceId,
        operation,
        chatId,
        labelId
      });
      return;
    }

    if (job.name === SEND_MANUAL_MESSAGE_JOB) {
      await processManualMessage(job.data as Partial<SendManualMessageJobData>, job.id);
      return;
    }

    if (job.name !== SEND_RECIPIENT_JOB) {
      return;
    }

    const recipientId = String(job.data?.recipientId ?? "");

    if (!recipientId) {
      return;
    }

    await processRecipient(recipientId);
  },
  {
    connection: redisConnectionOptions,
    concurrency: 1
  }
    );
    runtimeWorker = worker;
  } catch {
    clearInterval(heartbeatTimer);
    console.error("WORKER_RUNTIME_INITIALIZATION_FAILED");
    await closeWorkerRuntimeResources();
    process.exit(1);
  }

  try {
    await withTimeout(
      worker.waitUntilReady(),
      BULLMQ_READINESS_TIMEOUT_MS
    );
    await withTimeout(
      recordWorkerReadiness(heartbeatRedis),
      HEARTBEAT_INITIALIZATION_TIMEOUT_MS
    );
    readinessTimer = setInterval(() => {
      void withTimeout(
        recordWorkerReadiness(heartbeatRedis),
        HEARTBEAT_INITIALIZATION_TIMEOUT_MS
      ).catch(() => {
        console.error("WORKER_READINESS_PERIODIC_FAILED");
      });
    }, 15_000);
    readinessTimer.unref();
  } catch {
    clearInterval(heartbeatTimer);
    console.error("WORKER_BULLMQ_READINESS_FAILED");
    await closeWorkerRuntimeResources(worker);
    process.exit(1);
  }

  worker.on("failed", (job, error) => {
    console.error("[worker] sender-worker job failed", {
      jobId: job?.id,
      jobName: job?.name,
      error: error.message
    });
  });

  try {
    campaignScheduler = startCampaignScheduler();
  } catch {
    clearInterval(heartbeatTimer);
    if (readinessTimer) clearInterval(readinessTimer);
    console.error("WORKER_RUNTIME_INITIALIZATION_FAILED");
    await closeWorkerRuntimeResources(worker);
    process.exit(1);
  }
  let shuttingDown = false;

  async function shutdown(signal: "SIGTERM" | "SIGINT") {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("[worker] shutdown started", { signal });

    try {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (readinessTimer) clearInterval(readinessTimer);
      if (campaignScheduler) await campaignScheduler.stop();
      await closeWorkerRuntimeResources(worker);
      console.log("[worker] shutdown finished", { signal });
      process.exit(0);
    } catch {
      console.error("WORKER_SHUTDOWN_FAILED");
      await closeWorkerRuntimeResources(worker);
      process.exit(1);
    }
  }

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

void main().catch(async () => {
  console.error("WORKER_RUNTIME_INITIALIZATION_FAILED");
  if (cleanupRuntimeOnFatal) {
    await cleanupRuntimeOnFatal().catch(() => undefined);
  }
  process.exitCode = 1;
});
