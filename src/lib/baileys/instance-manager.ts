import makeWASocket, {
  ALL_WA_PATCH_NAMES,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type AnyMessageContent,
  type WASocket
} from "@whiskeysockets/baileys";
import { mkdir, readdir, rm } from "fs/promises";
import { join, resolve } from "path";
import P from "pino";
import QRCode from "qrcode";
import { WhatsappStatus, type WhatsappInstance } from "@prisma/client";
import { prisma } from "../prisma/client";
import { clearWhatsappOperationalData } from "../server/whatsapp-session-data";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  getDefaultWhatsappInstance,
  requireWhatsappInstance
} from "../server/whatsapp-instances";
import { toWhatsappJid } from "../phone/normalize";
import { normalizeBrazilPhone } from "../phone/normalize";
import { shouldIgnoreJidForX1Only } from "../whatsapp/jid";
import {
  applyWhatsappLabelToJids as applyWhatsappLabelToJidsDefault,
  removeWhatsappLabelFromJids as removeWhatsappLabelFromJidsDefault,
  disconnectBaileys,
  getWhatsappStatusPayload,
  requestWhatsappHistorySync,
  requestWhatsappCatalogSync,
  resetBaileysSession,
  sendWhatsappContentToJid,
  startBaileysConnection
} from "./client";
import {
  getMessageTimestamp,
  materializeWhatsappContactsAsChats,
  normalizeChatJid,
  syncChatsUpdate,
  syncChatsUpsert,
  syncContactsUpdate,
  syncContactsUpsert,
  syncMessagesUpdate,
  syncMessagesUpsert,
  syncMessagingHistorySet
} from "./sync";
import { syncLabelsAssociation, syncLabelsEdit } from "./labels-sync";
import { extractMessageText, isOptOutMessage } from "./opt-out";
import { getBaileysSessionFilesInfo } from "./session-files";
import { persistIdentityPair, persistIdentityPairs, rebuildPersistedIdentities } from "./identity-map";

const CATALOG_APP_STATE_COLLECTIONS = ALL_WA_PATCH_NAMES;
type CatalogAppStateCollection = (typeof CATALOG_APP_STATE_COLLECTIONS)[number];

async function clearInstanceCatalogAppStateVersionsForSnapshot(
  socket: WASocket,
  instanceId: string
) {
  const collections = [...CATALOG_APP_STATE_COLLECTIONS];
  const currentVersions = await socket.authState.keys.get(
    "app-state-sync-version",
    collections
  );
  const resetVersions = CATALOG_APP_STATE_COLLECTIONS.reduce(
    (versions, collection) => {
      versions[collection] = null;
      return versions;
    },
    {} as Record<CatalogAppStateCollection, null>
  );
  const versionSummary = CATALOG_APP_STATE_COLLECTIONS.reduce(
    (summary, collection) => {
      summary[collection] = currentVersions[collection]?.version ?? null;
      return summary;
    },
    {} as Record<CatalogAppStateCollection, number | null>
  );

  console.log("[catalog] instance force snapshot app-state versions backup", {
    instanceId,
    collections,
    versions: versionSummary
  });

  await socket.authState.keys.set({
    "app-state-sync-version": resetVersions
  });

  console.log("[catalog] instance force snapshot app-state versions cleared", {
    instanceId,
    collections
  });

  return {
    cleared: CATALOG_APP_STATE_COLLECTIONS.length
  };
}
const RECOVERABLE_SESSION_MESSAGE =
  "Sessao salva, aguardando retomada. Clique em Retomar sessao se nao reconectar automaticamente.";
const PAIRING_INCOMPLETE_MESSAGE =
  "QR expirou ou pareamento nao foi concluido. Gere um novo QR.";
const TEMPORARY_SOCKET_FAILURE_MESSAGE =
  "Falha temporaria do socket. Clique em Retomar sessao.";
const RECOVERABLE_RECONNECT_BACKOFF_MS = [5_000, 15_000, 30_000] as const;
const STREAM_RESTART_BACKOFF_MS = [3_000, 8_000, 15_000] as const;
const runtimeByInstanceId = new Map<string, WhatsappRuntime>();
const startPromiseByInstanceId = new Map<string, Promise<WASocket>>();
const INSTANCE_CONNECTION_TIMEOUT_MS = 30_000;
const INSTANCE_CONNECTION_POLL_MS = 250;
const AUTO_QUICK_SYNC_COOLDOWN_MS = 5 * 60_000;
const QR_RUNTIME_REVISION = "branch-cjs-direct-version-v1";

export class WhatsappInstanceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappInstanceUnavailableError";
  }
}

export type WhatsappRuntime = {
  instanceId: string;
  sessionKey: string;
  socket: WASocket | null;
  status: WhatsappStatus;
  qrCode: string | null;
  connectedPhone: string | null;
  displayName: string | null;
  profilePictureUrl: string | null;
  lastError: string | null;
  startedAt: Date | null;
  lastOpenAt: Date | null;
  lastSyncRequestedAt: Date | null;
  lastSocketEventAt: Date | null;
  lastLabelEventAt: Date | null;
  lastQuickSyncAt: Date | null;
  lastCatalogSyncAt: Date | null;
  lastHistorySyncAt: Date | null;
  nextReconnectAt: Date | null;
  lastErrorCode: string | null;
  autoReconnectDisabled: boolean;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

function getBaseSessionDir() {
  return process.env.BAILEYS_SESSION_DIR ?? "./data/baileys-session";
}

export function getBaileysSessionDirForInstance(instance: Pick<WhatsappInstance, "id" | "sessionKey">) {
  const baseDir = getBaseSessionDir();

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID || instance.sessionKey === "default") {
    return baseDir;
  }

  return join(baseDir, instance.sessionKey);
}

async function getBaileysSessionFilesInfoForInstance(
  instance: Pick<WhatsappInstance, "id" | "sessionKey">
) {
  return getBaileysSessionFilesInfo(getBaileysSessionDirForInstance(instance));
}

function getSessionIdForInstance(instanceId: string) {
  return instanceId === DEFAULT_WHATSAPP_INSTANCE_ID ? "default" : `instance:${instanceId}`;
}

async function ensureWhatsappSessionForInstance(instanceId: string) {
  const instance = await requireWhatsappInstance(instanceId);
  const sessionId = getSessionIdForInstance(instance.id);
  const existing = await prisma.whatsappSession.findFirst({
    where: {
      instanceId: instance.id
    }
  });

  if (existing) {
    return existing;
  }

  return prisma.whatsappSession.create({
    data: {
      id: sessionId,
      instanceId: instance.id,
      status: instance.status
    }
  });
}

async function updateInstanceSession(
  instanceId: string,
  data: {
    status: WhatsappStatus;
    qrCode?: string | null;
    connectedPhone?: string | null;
    lastError?: string | null;
    lastSyncAt?: Date | null;
  }
) {
  await ensureWhatsappSessionForInstance(instanceId);
  await prisma.whatsappSession.updateMany({
    where: {
      instanceId
    },
    data: {
      status: data.status,
      ...(data.qrCode !== undefined ? { qrCode: data.qrCode } : {}),
      ...(data.connectedPhone !== undefined ? { connectedPhone: data.connectedPhone } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {})
    }
  });
  await prisma.whatsappInstance.update({
    where: {
      id: instanceId
    },
    data: {
      status: data.status,
      ...(data.connectedPhone !== undefined ? { phone: data.connectedPhone } : {}),
      ...(data.status === WhatsappStatus.connected ? { lastConnectedAt: new Date() } : {}),
      ...(data.lastSyncAt !== undefined ? { lastSyncAt: data.lastSyncAt } : {})
    }
  });
}

function getRuntime(instance: Pick<WhatsappInstance, "id" | "sessionKey" | "status" | "phone">) {
  const existing = runtimeByInstanceId.get(instance.id);

  if (existing) {
    return existing;
  }

  const runtime: WhatsappRuntime = {
    instanceId: instance.id,
    sessionKey: instance.sessionKey,
    socket: null,
    status: instance.status,
    qrCode: null,
    connectedPhone: instance.phone,
    displayName: null,
    profilePictureUrl: null,
    lastError: null,
    startedAt: null,
    lastOpenAt: null,
    lastSyncRequestedAt: null,
    lastSocketEventAt: null,
    lastLabelEventAt: null,
    lastQuickSyncAt: null,
    lastCatalogSyncAt: null,
    lastHistorySyncAt: null,
    nextReconnectAt: null,
    lastErrorCode: null,
    autoReconnectDisabled: false,
    reconnectAttempts: 0,
    reconnectTimer: null
  };
  runtimeByInstanceId.set(instance.id, runtime);
  return runtime;
}

export async function resolveWhatsappInstance(instanceId?: string | null) {
  return requireWhatsappInstance(instanceId);
}

export async function getOrCreateWhatsappRuntime(instanceId?: string | null) {
  const instance = await resolveWhatsappInstance(instanceId);
  return getRuntime(instance);
}

export async function getWhatsappRuntime(instanceId: string) {
  return getOrCreateWhatsappRuntime(instanceId);
}

function getDisconnectStatusCode(error: unknown) {
  return (error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode ?? null;
}

function isStreamRestartError(statusCode: number | null, message: string | null) {
  return (
    statusCode === DisconnectReason.restartRequired ||
    statusCode === 515 ||
    /stream errored.*restart required|restart required/i.test(message ?? "")
  );
}

function hasResumableSession(options: {
  hasRegisteredSession?: boolean;
  hasMeId?: boolean;
  connectedPhone?: string | null;
  instancePhone?: string | null;
}) {
  return Boolean(
    options.hasRegisteredSession ||
    options.hasMeId
  );
}

async function scheduleRecoverableReconnect(
  instance: WhatsappInstance,
  runtime: WhatsappRuntime,
  options: {
    statusCode: number | null;
    lastError: string | null;
    sessionInfo: {
      sessionDir: string;
      sessionFilesCount: number;
      hasCredsJson: boolean;
      hasRegisteredSession?: boolean;
      hasMeId?: boolean;
      isPairingPartial?: boolean;
    };
  }
) {
  if (runtime.reconnectTimer) {
    console.log("[instance-manager] recoverable reconnect already scheduled", {
      instanceId: instance.id,
      statusCode: options.statusCode
    });
    return;
  }

  if (runtime.reconnectAttempts >= RECOVERABLE_RECONNECT_BACKOFF_MS.length) {
    runtime.status = WhatsappStatus.disconnected;
    runtime.qrCode = null;
    runtime.lastError = RECOVERABLE_SESSION_MESSAGE;
    await updateInstanceSession(instance.id, {
      status: WhatsappStatus.disconnected,
      qrCode: null,
      lastError: RECOVERABLE_SESSION_MESSAGE
    });
    console.log("[instance-manager] recoverable reconnect exhausted", {
      action: "resume_session",
      instanceId: instance.id,
      statusCode: options.statusCode,
      attempts: runtime.reconnectAttempts,
      sessionDir: options.sessionInfo.sessionDir,
      sessionFilesCount: options.sessionInfo.sessionFilesCount,
      hasCredsJson: options.sessionInfo.hasCredsJson,
      hasRegisteredSession: options.sessionInfo.hasRegisteredSession,
      hasMeId: options.sessionInfo.hasMeId,
      isPairingPartial: options.sessionInfo.isPairingPartial,
      isRecoverable: true
    });
    return;
  }

  const attempt = runtime.reconnectAttempts + 1;
  const delayMs =
    RECOVERABLE_RECONNECT_BACKOFF_MS[runtime.reconnectAttempts] ??
    RECOVERABLE_RECONNECT_BACKOFF_MS[RECOVERABLE_RECONNECT_BACKOFF_MS.length - 1];
  runtime.reconnectAttempts = attempt;
  runtime.nextReconnectAt = new Date(Date.now() + delayMs);
  runtime.lastErrorCode = options.statusCode ? String(options.statusCode) : "SOCKET_CLOSED";
  runtime.status = WhatsappStatus.connecting;
  runtime.qrCode = null;
  runtime.lastError = RECOVERABLE_SESSION_MESSAGE;
  await updateInstanceSession(instance.id, {
    status: WhatsappStatus.connecting,
    qrCode: null,
    lastError: RECOVERABLE_SESSION_MESSAGE
  });

  console.log("[instance-manager] recoverable close; scheduling reconnect", {
    action: "resume_session",
    instanceId: instance.id,
    statusCode: options.statusCode,
    attempt,
    delayMs,
    sessionDir: options.sessionInfo.sessionDir,
    sessionFilesCount: options.sessionInfo.sessionFilesCount,
    hasCredsJson: options.sessionInfo.hasCredsJson,
    hasRegisteredSession: options.sessionInfo.hasRegisteredSession,
    hasMeId: options.sessionInfo.hasMeId,
    isPairingPartial: options.sessionInfo.isPairingPartial,
    isRecoverable: true
  });

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    runtime.nextReconnectAt = null;
    console.log("[instance-manager] recoverable reconnect attempt", {
      action: "resume_session",
      instanceId: instance.id,
      statusCode: options.statusCode,
      attempt
    });
    void startSecondaryWhatsappInstance(instance).catch((error) => {
      console.warn("[instance-manager] recoverable reconnect failed", {
        instanceId: instance.id,
        attempt,
        error: errorMessage(error)
      });
    });
  }, delayMs);
}

async function scheduleSocketRestart(
  instance: WhatsappInstance,
  runtime: WhatsappRuntime,
  options: {
    action: "stream_error_restart_socket" | "post_qr_auto_resume";
    statusCode: number | null;
    errorMessage: string | null;
    sessionInfo: {
      sessionDir: string;
      sessionFilesCount: number;
      hasCredsJson: boolean;
      hasRegisteredSession?: boolean;
      hasMeId?: boolean;
      isPairingPartial?: boolean;
    };
  }
) {
  if (runtime.reconnectTimer) {
    console.log("[instance-manager] socket restart already scheduled", {
      action: options.action,
      instanceId: instance.id,
      statusCode: options.statusCode
    });
    return;
  }

  if (runtime.reconnectAttempts >= STREAM_RESTART_BACKOFF_MS.length) {
    runtime.status = WhatsappStatus.disconnected;
    runtime.qrCode = null;
    runtime.lastError = TEMPORARY_SOCKET_FAILURE_MESSAGE;
    await updateInstanceSession(instance.id, {
      status: WhatsappStatus.disconnected,
      qrCode: null,
      lastError: TEMPORARY_SOCKET_FAILURE_MESSAGE
    });
    console.warn("[instance-manager] socket restart attempts exhausted", {
      action: options.action,
      instanceId: instance.id,
      statusCode: options.statusCode,
      errorMessage: options.errorMessage,
      retryAttempt: runtime.reconnectAttempts,
      hasRegisteredSession: options.sessionInfo.hasRegisteredSession,
      hasMeId: options.sessionInfo.hasMeId
    });
    return;
  }

  const retryAttempt = runtime.reconnectAttempts + 1;
  const nextDelay = STREAM_RESTART_BACKOFF_MS[runtime.reconnectAttempts] ?? STREAM_RESTART_BACKOFF_MS[0];
  runtime.reconnectAttempts = retryAttempt;
  runtime.status = WhatsappStatus.connecting;
  runtime.qrCode = null;
  runtime.lastError = options.action === "post_qr_auto_resume"
    ? "QR lido. Finalizando conexao..."
    : TEMPORARY_SOCKET_FAILURE_MESSAGE;
  await updateInstanceSession(instance.id, {
    status: WhatsappStatus.connecting,
    qrCode: null,
    lastError: runtime.lastError
  });

  console.warn("[instance-manager] socket restart scheduled", {
    action: options.action,
    instanceId: instance.id,
    statusCode: options.statusCode,
    errorMessage: options.errorMessage,
    retryAttempt,
    nextDelay,
    hasRegisteredSession: options.sessionInfo.hasRegisteredSession,
    hasMeId: options.sessionInfo.hasMeId
  });

  runtime.reconnectTimer = setTimeout(() => {
    runtime.reconnectTimer = null;
    if (startPromiseByInstanceId.has(instance.id)) {
      console.log("[instance-manager] socket restart skipped; start already running", {
        action: options.action,
        instanceId: instance.id
      });
      return;
    }

    void startSecondaryWhatsappInstance(instance).catch((error) => {
      console.warn("[instance-manager] socket restart failed", {
        action: options.action,
        instanceId: instance.id,
        retryAttempt,
        error: errorMessage(error)
      });
    });
  }, nextDelay);
}

async function handleIncomingOptOutMessages(
  event: Parameters<typeof syncMessagesUpsert>[0],
  instanceId: string
) {
  for (const message of event.messages) {
    if (message.key.fromMe === true || !message.key.remoteJid?.endsWith("@s.whatsapp.net")) {
      continue;
    }

    const text = extractMessageText(message.message);

    if (!isOptOutMessage(text)) {
      continue;
    }

    const phoneFromJid = message.key.remoteJid.split("@")[0]?.split(":")[0] ?? "";
    const normalizedPhone = normalizeBrazilPhone(phoneFromJid);

    if (!normalizedPhone.ok) {
      continue;
    }

    await prisma.contact.updateMany({
      where: {
        instanceId,
        phoneNormalized: normalizedPhone.normalized
      },
      data: {
        optedOut: true
      }
    });
  }
}

function toRuntimeStatus(status: string | undefined | null) {
  if (
    status === WhatsappStatus.connected ||
    status === WhatsappStatus.connecting ||
    status === WhatsappStatus.disconnected ||
    status === WhatsappStatus.error ||
    status === WhatsappStatus.qr
  ) {
    return status;
  }

  return WhatsappStatus.disconnected;
}

async function startSecondaryWhatsappInstance(instance: WhatsappInstance) {
  const runtime = getRuntime(instance);
  const existingStart = startPromiseByInstanceId.get(instance.id);

  if (existingStart) {
    return existingStart;
  }

  if (runtime.socket && runtime.status === WhatsappStatus.connected) {
    return runtime.socket;
  }

  const startPromise = (async () => {
    const sessionDir = resolve(getBaileysSessionDirForInstance(instance));
    let sessionInfo = await getBaileysSessionFilesInfoForInstance(instance);
    if (runtime.socket && runtime.status !== WhatsappStatus.connected) {
      runtime.socket.end(new Error("Restarting instance connection"));
      runtime.socket = null;
    }
    runtime.status = WhatsappStatus.connecting;
    runtime.lastError = null;
    runtime.startedAt = new Date();
    await updateInstanceSession(instance.id, {
      status: WhatsappStatus.connecting,
      qrCode: null,
      lastError: null
    });
    await mkdir(sessionDir, { recursive: true });

    if (sessionInfo.isPairingPartial && !instance.phone) {
      console.log("[instance-manager] clearing partial pairing session before new qr", {
        action: "generate_qr",
        instanceId: instance.id,
        sessionDir: sessionInfo.sessionDir,
        sessionFilesCount: sessionInfo.sessionFilesCount,
        hasCredsJson: sessionInfo.hasCredsJson,
        hasRegisteredSession: sessionInfo.hasRegisteredSession,
        isPairingPartial: sessionInfo.isPairingPartial
      });
      await rm(sessionDir, { recursive: true, force: true });
      await mkdir(sessionDir, { recursive: true });
      sessionInfo = await getBaileysSessionFilesInfoForInstance(instance);
    }

    console.log("[instance-manager] starting instance", {
      action: sessionInfo.hasRegisteredSession || sessionInfo.hasMeId ? "resume_session" : "generate_qr",
      instanceId: instance.id,
      sessionDir: sessionInfo.sessionDir,
      sessionFilesCount: sessionInfo.sessionFilesCount,
      hasCredsJson: sessionInfo.hasCredsJson,
      hasRegisteredSession: sessionInfo.hasRegisteredSession,
      isPairingPartial: sessionInfo.isPairingPartial
    });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    console.log("[instance-manager] qr socket runtime", {
      revision: QR_RUNTIME_REVISION,
      version: version.join(".")
    });
    const socket = makeWASocket({
      version,
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      logger: P({ level: process.env.BAILEYS_LOG_LEVEL ?? "silent" }),
      printQRInTerminal: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false
    });
    runtime.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("messaging-history.set", (event) => {
      void syncMessagingHistorySet(event, instance.id).catch((error) => {
        console.warn("[instance-manager] history sync failed", {
          instanceId: instance.id,
          error: error instanceof Error ? error.message : "Erro desconhecido"
        });
      });
    });
    socket.ev.on("chats.upsert", (chats) => void syncChatsUpsert(chats, instance.id));
    socket.ev.on("chats.update", (chats) => void syncChatsUpdate(chats, instance.id));
    socket.ev.on("contacts.upsert", (contacts) => void syncContactsUpsert(contacts, instance.id));
    socket.ev.on("contacts.update", (contacts) => void syncContactsUpdate(contacts, instance.id));
    socket.ev.on("chats.phoneNumberShare", (event) => {
      void persistIdentityPair(instance.id, {
        lidJid: event.lid,
        phoneJid: event.jid,
        source: "PHONE_NUMBER_SHARE",
        evidence: "chats.phoneNumberShare"
      });
    });
    socket.ev.on("messages.upsert", (event) => {
      void handleIncomingOptOutMessages(event, instance.id);
      void syncMessagesUpsert(event, instance.id);
      void persistIdentityPairs(instance.id, event.messages, "MESSAGES_UPSERT");
    });
    socket.ev.on("messages.update", (messages) => void syncMessagesUpdate(messages, instance.id));
    socket.ev.on("labels.edit", (label) => void syncLabelsEdit(label, instance.id));
    socket.ev.on("labels.association", (event) => {
      runtime.lastSocketEventAt = new Date();
      runtime.lastLabelEventAt = runtime.lastSocketEventAt;
      void syncLabelsAssociation(event, instance.id);
    });

    socket.ev.on("connection.update", (update) => {
      void (async () => {
        runtime.lastSocketEventAt = new Date();
        if (update.qr) {
          const qrCode = await QRCode.toDataURL(update.qr);
          runtime.status = WhatsappStatus.qr;
          runtime.qrCode = qrCode;
          runtime.lastError = null;
          await updateInstanceSession(instance.id, {
            status: WhatsappStatus.qr,
            qrCode,
            lastError: null
          });
          console.log("[instance-manager] qr updated", {
            action: "generate_qr",
            instanceId: instance.id,
            hasQr: true,
            persistedQr: true
          });
          return;
        }

        if (update.connection === "open") {
          const connectedPhone = normalizeChatJid(socket.user?.id)?.split("@")[0] ?? null;
          const ownJid = normalizeChatJid(socket.user?.id);
          const displayName = socket.user?.name ?? null;
          const profilePictureUrl =
            ownJid && typeof socket.profilePictureUrl === "function"
              ? await socket.profilePictureUrl(ownJid).catch(() => null)
              : null;
          const previousPhone = instance.phone;
          runtime.status = WhatsappStatus.connected;
          runtime.connectedPhone = connectedPhone;
          runtime.displayName = displayName;
          runtime.profilePictureUrl = profilePictureUrl ?? null;
          runtime.qrCode = null;
          runtime.lastError = null;
          runtime.lastOpenAt = new Date();
          runtime.reconnectAttempts = 0;
          runtime.nextReconnectAt = null;
          runtime.lastErrorCode = null;
          if (runtime.reconnectTimer) {
            clearTimeout(runtime.reconnectTimer);
            runtime.reconnectTimer = null;
          }
          await updateInstanceSession(instance.id, {
            status: WhatsappStatus.connected,
            qrCode: null,
            connectedPhone,
            lastError: null
          });
          console.log("[instance-manager] socket open", {
            instanceId: instance.id
          });

          if (previousPhone && connectedPhone && previousPhone !== connectedPhone) {
            await clearWhatsappOperationalData("phone-changed-instance", instance.id);
          }

          const now = Date.now();
          if (
            !runtime.lastQuickSyncAt ||
            now - runtime.lastQuickSyncAt.getTime() >= AUTO_QUICK_SYNC_COOLDOWN_MS
          ) {
            runtime.lastQuickSyncAt = new Date(now);
            void requestWhatsappCatalogSyncForInstance(instance.id)
              .then(() => {
                runtime.lastCatalogSyncAt = new Date();
              })
              .catch((error) => {
                runtime.lastErrorCode = "AUTO_QUICK_SYNC_FAILED";
                console.warn("[instance-manager] automatic quick sync failed", {
                  instanceId: instance.id,
                  error: errorMessage(error)
                });
              });
          }
          return;
        }

        if (update.connection === "close") {
          if (runtime.socket && runtime.socket !== socket) {
            console.log("[instance-manager] stale socket close ignored", {
              instanceId: instance.id
            });
            return;
          }
          const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
          const sessionInfo = await getBaileysSessionFilesInfoForInstance(instance);
          const closeErrorMessage = update.lastDisconnect?.error
            ? errorMessage(update.lastDisconnect.error)
            : null;
          const hasSavedSession = hasResumableSession({
            hasRegisteredSession: sessionInfo.hasRegisteredSession,
            hasMeId: sessionInfo.hasMeId,
            connectedPhone: runtime.connectedPhone,
            instancePhone: instance.phone
          });
          const hadPairingQr = Boolean(runtime.qrCode);
          runtime.socket = null;
          runtime.lastError = closeErrorMessage;
          runtime.lastErrorCode = statusCode ? String(statusCode) : "SOCKET_CLOSED";

          if (statusCode === DisconnectReason.loggedOut) {
            runtime.autoReconnectDisabled = true;
          }

          if (sessionInfo.isPairingPartial && !hasSavedSession) {
            runtime.lastError = PAIRING_INCOMPLETE_MESSAGE;
          }

          if (hasSavedSession && isStreamRestartError(statusCode, closeErrorMessage)) {
            await scheduleSocketRestart(instance, runtime, {
              action: "stream_error_restart_socket",
              statusCode,
              errorMessage: closeErrorMessage,
              sessionInfo
            });
            return;
          }

          if (hasSavedSession && hadPairingQr) {
            await scheduleSocketRestart(instance, runtime, {
              action: "post_qr_auto_resume",
              statusCode,
              errorMessage: closeErrorMessage,
              sessionInfo
            });
            return;
          }

          if (statusCode === 428 && hasSavedSession) {
            await scheduleRecoverableReconnect(instance, runtime, {
              statusCode,
              lastError: runtime.lastError,
              sessionInfo
            });
            return;
          }

          runtime.status = WhatsappStatus.disconnected;
          await updateInstanceSession(instance.id, {
            status: WhatsappStatus.disconnected,
            qrCode: null,
            lastError: runtime.lastError
          });
          console.log("[instance-manager] socket closed", {
            instanceId: instance.id,
            statusCode,
            sessionDir: sessionInfo.sessionDir,
            sessionFilesCount: sessionInfo.sessionFilesCount,
            hasCredsJson: sessionInfo.hasCredsJson,
            hasRegisteredSession: sessionInfo.hasRegisteredSession,
            isPairingPartial: sessionInfo.isPairingPartial,
            hasQr: Boolean(runtime.qrCode),
            persistedQr: Boolean(runtime.qrCode),
            isRecoverable: false
          });

          if (statusCode && statusCode !== DisconnectReason.loggedOut) {
            startPromiseByInstanceId.delete(instance.id);
          }
        }
      })().catch((error) => {
        console.error("[instance-manager] connection update failed", {
          instanceId: instance.id,
          error: errorMessage(error)
        });
      });
    });

    return socket;
  })().finally(() => {
    startPromiseByInstanceId.delete(instance.id);
  });

  startPromiseByInstanceId.set(instance.id, startPromise);
  return startPromise;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

export async function startWhatsappInstance(instanceId?: string | null) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    await startBaileysConnection();
    return getWhatsappStatusPayload();
  }

  getRuntime(instance).autoReconnectDisabled = false;
  await startSecondaryWhatsappInstance(instance);
  return getWhatsappInstanceRuntimeStatus(instance.id);
}

export const startBaileysConnectionForInstance = startWhatsappInstance;

export async function reconnectWhatsappInstance(instanceId?: string | null) {
  return startWhatsappInstance(instanceId);
}

export async function disconnectWhatsappInstance(instanceId?: string | null) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    await disconnectBaileys();
    return getWhatsappStatusPayload();
  }

  const runtime = getRuntime(instance);
  if (runtime.reconnectTimer) {
    clearTimeout(runtime.reconnectTimer);
    runtime.reconnectTimer = null;
  }
  runtime.reconnectAttempts = 0;
  runtime.nextReconnectAt = null;
  runtime.autoReconnectDisabled = true;
  runtime.socket?.end(new Error("Manual disconnect"));
  runtime.socket = null;
  runtime.status = WhatsappStatus.disconnected;
  runtime.qrCode = null;
  runtime.lastError = null;
  await updateInstanceSession(instance.id, {
    status: WhatsappStatus.disconnected,
    qrCode: null,
    lastError: null
  });
  console.log("[instance-manager] disconnected instance", {
    instanceId: instance.id
  });
  return getWhatsappInstanceRuntimeStatus(instance.id);
}

export const disconnectBaileysForInstance = disconnectWhatsappInstance;

export async function resetWhatsappInstance(instanceId?: string | null) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    await resetBaileysSession();
    return getWhatsappStatusPayload();
  }

  await disconnectWhatsappInstance(instance.id);
  const sessionDir = resolve(getBaileysSessionDirForInstance(instance));
  await rm(sessionDir, { recursive: true, force: true });
  await clearWhatsappOperationalData("manual-reset-instance", instance.id);
  await updateInstanceSession(instance.id, {
    status: WhatsappStatus.disconnected,
    qrCode: null,
    connectedPhone: null,
    lastError: null
  });
  console.log("[instance-manager] reset instance", {
    instanceId: instance.id
  });
  return getWhatsappInstanceRuntimeStatus(instance.id);
}

export const resetBaileysSessionForInstance = resetWhatsappInstance;

async function removeWhatsappInstanceSessionDir(
  instance: Pick<WhatsappInstance, "id" | "sessionKey">
) {
  const sessionDir = resolve(getBaileysSessionDirForInstance(instance));

  if (instance.id !== DEFAULT_WHATSAPP_INSTANCE_ID && instance.sessionKey !== "default") {
    await rm(sessionDir, { recursive: true, force: true });
    return;
  }

  const entries = await readdir(sessionDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    await rm(resolve(sessionDir, entry.name), { recursive: true, force: true });
  }
}

export async function deleteWhatsappInstance(instanceId: string) {
  const instance = await resolveWhatsappInstance(instanceId);
  await disconnectWhatsappInstance(instance.id);

  const replacementDefault = instance.isDefault
    ? await prisma.whatsappInstance.findFirst({
        where: { id: { not: instance.id } },
        orderBy: { createdAt: "asc" }
      })
    : null;

  await prisma.$transaction(async (transaction) => {
    await transaction.sendLog.deleteMany({ where: { instanceId: instance.id } });
    await transaction.campaignRecipient.deleteMany({ where: { instanceId: instance.id } });
    await transaction.campaign.deleteMany({ where: { instanceId: instance.id } });
    await transaction.contact.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappChatLabel.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappMessage.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappLabel.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappContact.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappChat.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappSession.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappInstance.delete({ where: { id: instance.id } });

    if (replacementDefault) {
      await transaction.whatsappInstance.update({
        where: { id: replacementDefault.id },
        data: { isDefault: true }
      });
    }
  });

  await removeWhatsappInstanceSessionDir(instance);
  runtimeByInstanceId.delete(instance.id);
  startPromiseByInstanceId.delete(instance.id);

  console.log("[instance-manager] deleted instance", {
    instanceId: instance.id
  });

  return {
    deletedInstanceId: instance.id,
    nextActiveInstanceId: replacementDefault?.id ?? null
  };
}

export async function getWhatsappInstanceRuntimeStatus(instanceId?: string | null) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    return {
      ...(await getWhatsappStatusPayload()),
      instanceId: instance.id,
      instanceName: instance.name,
      instanceRole: instance.role,
      lastConnectedAt: instance.lastConnectedAt?.toISOString() ?? null,
      lastSyncAt: instance.lastSyncAt?.toISOString() ?? null
    };
  }

  const runtime = getRuntime(instance);
  const session = await ensureWhatsappSessionForInstance(instance.id);
  const sessionInfo = await getBaileysSessionFilesInfoForInstance(instance);
  const hasSessionFiles = sessionInfo.sessionFilesCount > 0;
  const connectedPhone = runtime.connectedPhone ?? session.connectedPhone ?? instance.phone;
  const currentStatus = runtime.status ?? session.status;
  const hasConfirmedSession =
    sessionInfo.hasRegisteredSession ||
    sessionInfo.hasMeId;

  return {
    id: session.id,
    instanceId: instance.id,
    instanceName: instance.name,
    instanceRole: instance.role,
    status: runtime.status ?? session.status,
    qrCode: runtime.qrCode ?? session.qrCode,
    hasQrCode: Boolean(runtime.qrCode ?? session.qrCode),
    hasQr: Boolean(runtime.qrCode ?? session.qrCode),
    hasSessionFiles,
    sessionFilesCount: sessionInfo.sessionFilesCount,
    hasCredsJson: sessionInfo.hasCredsJson,
    hasRegisteredSession: sessionInfo.hasRegisteredSession,
    hasMe: sessionInfo.hasMe,
    hasMeId: sessionInfo.hasMeId,
    isPairingPartial: sessionInfo.isPairingPartial,
    connectedPhone,
    displayName: runtime.displayName,
    profilePictureUrl: runtime.profilePictureUrl,
    hasLiveSocket: Boolean(runtime.socket),
    lastError: runtime.lastError ?? session.lastError,
    updatedAt: session.updatedAt.toISOString(),
    lastOpenAt: runtime.lastOpenAt?.toISOString() ?? null,
    lastConnectedAt: instance.lastConnectedAt?.toISOString() ?? null,
    lastSyncAt: instance.lastSyncAt?.toISOString() ?? null,
    lastSocketEventAt: runtime.lastSocketEventAt?.toISOString() ?? null,
    lastLabelEventAt: runtime.lastLabelEventAt?.toISOString() ?? null,
    lastQuickSyncAt: runtime.lastQuickSyncAt?.toISOString() ?? null,
    lastCatalogSyncAt: runtime.lastCatalogSyncAt?.toISOString() ?? null,
    lastHistorySyncAt: runtime.lastHistorySyncAt?.toISOString() ?? null,
    reconnectAttempts: runtime.reconnectAttempts,
    nextReconnectAt: runtime.nextReconnectAt?.toISOString() ?? null,
    lastErrorCode: runtime.lastErrorCode,
    autoReconnectDisabled: runtime.autoReconnectDisabled,
    isRecoverableSession:
      hasConfirmedSession &&
      (!runtime.socket || currentStatus !== WhatsappStatus.connected) &&
      !Boolean(runtime.qrCode ?? session.qrCode)
  };
}

async function getConnectedInstanceSocket(instanceId: string) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    throw new Error("Default instance uses legacy sender wrapper");
  }

  const runtime = getRuntime(instance);

  if (
    !runtime.socket ||
    (
      runtime.status !== WhatsappStatus.connected &&
      runtime.status !== WhatsappStatus.connecting
    )
  ) {
    await startSecondaryWhatsappInstance(instance);
  }

  const deadline = Date.now() + INSTANCE_CONNECTION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (runtime.socket && runtime.status === WhatsappStatus.connected) {
      return runtime.socket;
    }

    if (!runtime.socket && !startPromiseByInstanceId.has(instance.id)) {
      await startSecondaryWhatsappInstance(instance);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, INSTANCE_CONNECTION_POLL_MS);
    });
  }

  throw new WhatsappInstanceUnavailableError(
    `Instancia WhatsApp nao conectou em ${
      INSTANCE_CONNECTION_TIMEOUT_MS / 1000
    } segundos para envio.`
  );
}

export async function rebuildWhatsappIdentitiesForInstance(
  instanceId: string,
  candidatePhones: string[] = []
) {
  const socket = await getConnectedInstanceSocket(instanceId);
  const persisted = await rebuildPersistedIdentities(instanceId);
  const contacts = await prisma.whatsappContact.findMany({
    where: {
      instanceId,
      OR: [{ jid: { endsWith: "@s.whatsapp.net" } }, { jid: { endsWith: "@c.us" } }]
    },
    select: { jid: true }
  });
  const uniqueJids = [...new Set([
    ...contacts.map((contact) => contact.jid.replace(/@c\.us$/, "@s.whatsapp.net")),
    ...candidatePhones.map((phone) => `${phone}@s.whatsapp.net`)
  ])];
  let queried = 0;
  let observed = 0;
  let created = 0;
  let unchanged = 0;
  let ambiguous = 0;
  for (let index = 0; index < uniqueJids.length; index += 100) {
    const batch = uniqueJids.slice(index, index + 100);
    const results = await socket.onWhatsApp(...batch);
    queried += batch.length;
    for (const result of results ?? []) {
      if (!result.lid || !result.jid) continue;
      observed++;
      const saved = await persistIdentityPair(instanceId, {
        lidJid: String(result.lid),
        phoneJid: result.jid,
        source: "USYNC_CONTACT_LID",
        evidence: "onWhatsApp.contact+lid"
      });
      if (saved.status === "created") created++;
      if (saved.status === "unchanged") unchanged++;
      if (saved.status === "ambiguous") ambiguous++;
    }
  }
  return { persisted, queried, observed, created, unchanged, ambiguous };
}

export async function sendWhatsappMessageForInstance(instanceId: string, jid: string, text: string) {
  const messageText = text.trim();

  if (!messageText) {
    throw new Error("Mensagem vazia");
  }

  return sendWhatsappContentForInstance(instanceId, jid, { text: messageText });
}

export async function sendWhatsappContentForInstance(
  instanceId: string,
  jid: string,
  content: AnyMessageContent
) {
  const instance = await resolveWhatsappInstance(instanceId);
  const normalizedJid = normalizeChatJid(jid);

  if (!normalizedJid) {
    throw new Error("JID de destino invalido");
  }

  if (shouldIgnoreJidForX1Only(normalizedJid)) {
    throw new Error("JID ignorado pelo modo de envio individual");
  }

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    return sendWhatsappContentToJid(normalizedJid, content);
  }

  console.log("[manual-send] sending with instance", {
    instanceId: instance.id
  });
  const socket = await getConnectedInstanceSocket(instance.id);
  const sentMessage = await socket.sendMessage(normalizedJid, content);

  return {
    waMessageId: sentMessage?.key?.id ?? null,
    senderJid: normalizeChatJid(socket.user?.id),
    rawJson: {
      key: {
        id: sentMessage?.key?.id ?? null,
        remoteJid: sentMessage?.key?.remoteJid ?? normalizedJid,
        fromMe: sentMessage?.key?.fromMe ?? true
      },
      messageTimestamp: getMessageTimestamp(sentMessage?.messageTimestamp ?? null),
      status: sentMessage?.status ?? null
    }
  };
}

export const sendWhatsappMessageToJidForInstance = sendWhatsappMessageForInstance;

export async function sendWhatsappPhoneMessageForInstance(
  instanceId: string,
  phoneNormalized: string,
  message: string
) {
  return sendWhatsappMessageForInstance(instanceId, toWhatsappJid(phoneNormalized), message);
}

export async function requestWhatsappHistorySyncForInstance(instanceId: string) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    const result = await requestWhatsappHistorySync();
    const materialized = await materializeWhatsappContactsAsChats(instance.id);

    return {
      ...result,
      materialized
    };
  }

  const session = await getWhatsappInstanceRuntimeStatus(instance.id);

  if (session.status !== WhatsappStatus.connected) {
    console.log("[history] sync-whatsapp-history skipped; not connected", {
      instanceId: instance.id,
      status: session.status
    });

    return {
      ok: false,
      mode: "event-driven" as const,
      message: "WhatsApp nao esta conectado. Reconecte primeiro."
    };
  }

  const materialized = await materializeWhatsappContactsAsChats(instance.id);
  const [chatCount, contactCount, messageCount] = await Promise.all([
    prisma.whatsappChat.count({
      where: {
        instanceId: instance.id
      }
    }),
    prisma.whatsappContact.count({
      where: {
        instanceId: instance.id
      }
    }),
    prisma.whatsappMessage.count({
      where: {
        instanceId: instance.id
      }
    })
  ]);

  console.log("[history] sync-whatsapp-history requested", {
    instanceId: instance.id,
    mode: "event-driven",
    chats: chatCount,
    contacts: contactCount,
    messages: messageCount,
    materialized
  });

  return {
    ok: true,
    mode: "event-driven" as const,
    counts: {
      chats: chatCount,
      contacts: contactCount,
      messages: messageCount
    },
    materialized,
    hasFetchMessageHistory: false,
    canUseOnDemandHistory: false,
    message: "Historico verificado e contatos materializados para a instancia solicitada."
  };
}

export async function requestWhatsappCatalogSyncForInstance(
  instanceId: string,
  options: { forceSnapshot?: boolean } = {}
) {
  const instance = await resolveWhatsappInstance(instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    const result = await requestWhatsappCatalogSync(options);
    const materialized = await materializeWhatsappContactsAsChats(instance.id);
    await prisma.whatsappInstance.update({
      where: {
        id: instance.id
      },
      data: {
        lastSyncAt: new Date()
      }
    }).catch(() => undefined);
    return {
      ...result,
      materialized
    };
  }

  const socket = await getConnectedInstanceSocket(instance.id);
  console.log("[catalog] sync requested", {
    instanceId: instance.id
  });

  const resyncAppState =
    typeof socket.resyncAppState === "function" ? socket.resyncAppState.bind(socket) : null;

  if (!resyncAppState) {
    return {
      ok: false,
      mode: "resync-app-state" as const,
      message: "Socket Baileys conectado nao expoe resyncAppState."
    };
  }

  const forceSnapshot = options.forceSnapshot === true;
  let snapshotReset: { cleared: number } | null = null;

  if (forceSnapshot) {
    snapshotReset = await clearInstanceCatalogAppStateVersionsForSnapshot(
      socket,
      instance.id
    );
  }

  console.log("[catalog] app-state resync requested", {
    instanceId: instance.id,
    forceSnapshot,
    isInitialSync: true,
    snapshotReset
  });
  await resyncAppState(CATALOG_APP_STATE_COLLECTIONS, true);

  console.log("[catalog] app-state resync finished", {
    instanceId: instance.id,
    forceSnapshot,
    snapshotReset
  });

  const materialized = await materializeWhatsappContactsAsChats(instance.id);

  await prisma.whatsappInstance.update({
    where: {
      id: instance.id
    },
    data: {
      lastSyncAt: new Date()
    }
  });

  return {
    ok: true,
    mode: "resync-app-state" as const,
    forceSnapshot,
    snapshotReset,
    materialized,
    message: "Sincronizacao da instancia solicitada."
  };
}

export async function applyWhatsappLabelsForInstance(params: {
  instanceId: string;
  waLabelId: string;
  jids: string[];
}) {
  const instance = await resolveWhatsappInstance(params.instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    return applyWhatsappLabelToJidsDefault({
      waLabelId: params.waLabelId,
      jids: params.jids
    });
  }

  const socket = await getConnectedInstanceSocket(instance.id);
  const addChatLabel =
    typeof socket.addChatLabel === "function" ? socket.addChatLabel.bind(socket) : null;

  if (!addChatLabel) {
    return {
      ok: false,
      applied: 0,
      skipped: params.jids.length,
      failed: 0,
      message: "Socket Baileys conectado nao expoe addChatLabel."
    };
  }

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const jid of Array.from(new Set(params.jids))) {
    const normalizedJid = normalizeChatJid(jid);

    if (!normalizedJid || shouldIgnoreJidForX1Only(normalizedJid)) {
      skipped += 1;
      continue;
    }

    try {
      await addChatLabel(normalizedJid, params.waLabelId);
      applied += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    ok: failed === 0,
    applied,
    skipped,
    failed,
    message: `Etiquetas aplicadas: ${applied}.`
  };
}

export async function mutateWhatsappChatLabelForInstance(params: {
  instanceId: string;
  operation: "apply" | "remove";
  waLabelId: string;
  jid: string;
}) {
  const instance = await resolveWhatsappInstance(params.instanceId);

  if (instance.id === DEFAULT_WHATSAPP_INSTANCE_ID) {
    return params.operation === "apply"
      ? applyWhatsappLabelToJidsDefault({
          waLabelId: params.waLabelId,
          jids: [params.jid]
        })
      : removeWhatsappLabelFromJidsDefault({
          waLabelId: params.waLabelId,
          jids: [params.jid]
        });
  }

  const socket = await getConnectedInstanceSocket(instance.id);
  const mutate =
    params.operation === "apply"
      ? socket.addChatLabel?.bind(socket)
      : socket.removeChatLabel?.bind(socket);

  if (!mutate) {
    throw new Error("Operação de etiqueta indisponível no socket Baileys");
  }

  await mutate(params.jid, params.waLabelId);
  return { ok: true };
}

export { getDefaultWhatsappInstance };
