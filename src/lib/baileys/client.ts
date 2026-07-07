import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type BaileysEventMap,
  type proto,
  type WASocket
} from "@whiskeysockets/baileys";
import { mkdir, readdir, rm, unlink, writeFile } from "fs/promises";
import { join, parse, resolve } from "path";
import P from "pino";
import QRCode from "qrcode";
import { WhatsappStatus, type Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";
import { normalizeBrazilPhone, toWhatsappJid } from "../phone/normalize";
import { extractMessageText, isOptOutMessage } from "./opt-out";
import {
  syncChatsUpdate,
  syncChatsUpsert,
  syncContactsUpdate,
  syncContactsUpsert,
  syncMessagesUpdate,
  syncMessagesUpsert,
  syncMessagingHistorySet,
  normalizeChatJid
} from "./sync";
import { syncLabelsAssociation, syncLabelsEdit } from "./labels-sync";

const SESSION_ID = "default";

let socket: WASocket | null = null;
let startPromise: Promise<WASocket> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let qrTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let manualDisconnectRequested = false;
let hasReceivedQr = false;
let pairingPending = false;
let connectRetryCount = 0;
let socketGeneration = 0;
let status515RestartCount = 0;
let generalReconnectCount = 0;
let lastTerminalErrorAt: number | null = null;
let lastResetSucceededAt: number | null = null;
let resetInProgress = false;
let cleanPairingProfileIndex = 0;

const MAX_GENERAL_RECONNECT_ATTEMPTS = 5;
const TERMINAL_COOLDOWN_MS = 15_000;
const TERMINAL_SESSION_MESSAGE =
  "Conexao WhatsApp encerrada ou removida no celular. Use Resetar sessao e Reconectar para gerar novo QR.";
const QR_SAFE_428_MESSAGE =
  "Falha ao gerar QR mesmo em modo seguro. Tente Resetar sessao e Reconectar novamente.";
const QR_SAFE_405_EXHAUSTED_MESSAGE =
  "Falha ao gerar QR: todos os perfis seguros de pareamento retornaram erro 405. Tente novamente em alguns minutos ou revise a versao/browser Baileys.";

type CleanPairingProfile = {
  id: string;
  browserLabel: string;
  versionMode: "local-default" | "latest";
  browser: () => ReturnType<typeof Browsers.ubuntu>;
};

const CLEAN_PAIRING_PROFILES: CleanPairingProfile[] = [
  {
    id: "ubuntu-chrome-local-default",
    browserLabel: "ubuntu-chrome",
    versionMode: "local-default",
    browser: () => Browsers.ubuntu("Chrome")
  },
  {
    id: "ubuntu-chrome-latest",
    browserLabel: "ubuntu-chrome",
    versionMode: "latest",
    browser: () => Browsers.ubuntu("Chrome")
  },
  {
    id: "macos-desktop-local-default",
    browserLabel: "macos-desktop",
    versionMode: "local-default",
    browser: () => Browsers.macOS("Desktop")
  },
  {
    id: "macos-desktop-latest",
    browserLabel: "macos-desktop",
    versionMode: "latest",
    browser: () => Browsers.macOS("Desktop")
  }
];

export class BaileysStartSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BaileysStartSkippedError";
  }
}

export function isBaileysStartSkippedError(error: unknown) {
  return error instanceof BaileysStartSkippedError;
}

function getSessionDir() {
  return process.env.BAILEYS_SESSION_DIR ?? "./data/baileys-session";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearQrTimeoutTimer() {
  if (qrTimeoutTimer) {
    clearTimeout(qrTimeoutTimer);
    qrTimeoutTimer = null;
  }
}

function invalidateSocketHandlers() {
  socketGeneration += 1;
}

function resetReconnectCounters() {
  connectRetryCount = 0;
  status515RestartCount = 0;
  generalReconnectCount = 0;
}

function getCleanPairingProfile() {
  return CLEAN_PAIRING_PROFILES[cleanPairingProfileIndex] ?? CLEAN_PAIRING_PROFILES[0];
}

function advanceCleanPairingProfile() {
  if (cleanPairingProfileIndex + 1 >= CLEAN_PAIRING_PROFILES.length) {
    return null;
  }

  cleanPairingProfileIndex += 1;
  return getCleanPairingProfile();
}

function resetCleanPairingProfiles(options: { log?: boolean } = {}) {
  cleanPairingProfileIndex = 0;

  if (options.log) {
    console.log("[baileys] qr safe profiles reset");
  }
}

function isPairingPendingSession(session: { status: WhatsappStatus; connectedPhone?: string | null }) {
  return session.status === WhatsappStatus.qr && !session.connectedPhone;
}

function isTerminalSessionStatusCode(statusCode: number | undefined) {
  if (statusCode === undefined) {
    return false;
  }

  return (
    statusCode === 428 ||
    statusCode === DisconnectReason.loggedOut ||
    statusCode === DisconnectReason.badSession ||
    statusCode === DisconnectReason.connectionReplaced ||
    statusCode === DisconnectReason.multideviceMismatch
  );
}

function sanitizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "Erro desconhecido";
}

function getDisconnectStatusCode(error: unknown) {
  return (error as { output?: { statusCode?: number } } | null)?.output?.statusCode;
}

function getMessageTimestampForJson(messageTimestamp: unknown) {
  if (typeof messageTimestamp === "number" || typeof messageTimestamp === "string") {
    return messageTimestamp;
  }

  if (messageTimestamp && typeof messageTimestamp === "object" && "toString" in messageTimestamp) {
    return String(messageTimestamp);
  }

  return null;
}

function isJsonObject(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractStoredMessage(rawJson: Prisma.JsonValue | null): proto.IMessage | undefined {
  if (!isJsonObject(rawJson) || !isJsonObject(rawJson.message)) {
    return undefined;
  }

  return rawJson.message as proto.IMessage;
}

async function getStoredMessage(key: proto.IMessageKey) {
  const jid = normalizeChatJid(key.remoteJid);
  const waMessageId = String(key.id ?? "").trim();

  if (!jid || !waMessageId) {
    return undefined;
  }

  const storedMessage = await prisma.whatsappMessage.findUnique({
    where: {
      jid_waMessageId: {
        jid,
        waMessageId
      }
    },
    select: {
      rawJson: true
    }
  });

  return extractStoredMessage(storedMessage?.rawJson ?? null);
}

async function saveWhatsappSession(data: {
  status: WhatsappStatus;
  qrCode?: string | null;
  connectedPhone?: string | null;
  lastError?: string | null;
}) {
  await prisma.whatsappSession.upsert({
    where: {
      id: SESSION_ID
    },
    update: data,
    create: {
      id: SESSION_ID,
      ...data
    }
  });
}

async function assertSessionDirWritable(sessionDir: string) {
  const writeTestPath = join(sessionDir, ".write-test");

  try {
    await writeFile(writeTestPath, "ok");
    await unlink(writeTestPath);
  } catch {
    await unlink(writeTestPath).catch(() => undefined);
    const message = `Sem permissao de escrita no diretorio da sessao Baileys: ${sessionDir}`;
    await saveWhatsappSession({
      status: WhatsappStatus.error,
      qrCode: null,
      connectedPhone: null,
      lastError: message
    });
    throw new Error(message);
  }
}

function getSafeSessionDir() {
  const sessionDir = resolve(getSessionDir());
  const root = parse(sessionDir).root;
  const normalizedSessionDir = sessionDir.toLowerCase();

  if (
    sessionDir === root ||
    sessionDir.length < 8 ||
    (!normalizedSessionDir.includes("baileys") && !normalizedSessionDir.includes("session"))
  ) {
    throw new Error(`Diretorio de sessao Baileys inseguro para reset: ${sessionDir}`);
  }

  return sessionDir;
}

async function countSessionFiles() {
  const sessionDir = getSafeSessionDir();
  await mkdir(sessionDir, { recursive: true });

  async function countInDir(dir: string): Promise<number> {
    const entries = await readdir(dir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        count += await countInDir(fullPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }

    return count;
  }

  return countInDir(sessionDir);
}

async function clearSessionDir() {
  const sessionDir = getSafeSessionDir();
  await mkdir(sessionDir, { recursive: true });

  const entries = await readdir(sessionDir, { withFileTypes: true });

  for (const entry of entries) {
    await rm(join(sessionDir, entry.name), {
      recursive: true,
      force: true
    });
  }

  await mkdir(sessionDir, { recursive: true });
}

function scheduleReconnect(delayMs: number, reason: string) {
  if (manualDisconnectRequested || resetInProgress) {
    console.log("[baileys] reconnect skipped after manual disconnect", { reason });
    return;
  }

  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startBaileysConnection({ resetRetry: false }).catch((error) => {
      if (!isBaileysStartSkippedError(error)) {
        console.warn("[baileys] scheduled reconnect failed", {
          error: sanitizeErrorMessage(error)
        });
      }
    });
  }, delayMs);
}

function scheduleQrTimeout() {
  clearQrTimeoutTimer();
  qrTimeoutTimer = setTimeout(() => {
    qrTimeoutTimer = null;
    void (async () => {
      const session = await getWhatsappStatus();

      if (session.status !== WhatsappStatus.connecting) {
        return;
      }

      const lastError = "Baileys iniciou, mas ainda nao recebeu QR Code";
      await saveWhatsappSession({
        status: WhatsappStatus.connecting,
        qrCode: null,
        connectedPhone: null,
        lastError
      });
      console.warn("[baileys] qr timeout", { lastError });
    })();
  }, 25_000);
}

function logAsyncHandlerError(scope: string, error: unknown) {
  console.warn(`[${scope}] handler failed`, {
    error: sanitizeErrorMessage(error)
  });
}

async function handleIncomingMessages(event: BaileysEventMap["messages.upsert"]) {
  for (const message of event.messages ?? []) {
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
        phoneNormalized: normalizedPhone.normalized
      },
      data: {
        optedOut: true
      }
    });
  }
}

async function createSocket(options: {
  sessionFileCount: number;
  shouldUseQrSafeMode: boolean;
  hasStoredPairingQr: boolean;
}) {
  invalidateSocketHandlers();
  const localGeneration = socketGeneration;
  const { sessionFileCount, shouldUseQrSafeMode, hasStoredPairingQr } = options;
  const isCleanPairing = shouldUseQrSafeMode;

  if (socket) {
    socket.end(new Error("Replacing existing socket"));
    socket = null;
  }

  const sessionDir = getSessionDir();
  clearReconnectTimer();
  hasReceivedQr = false;
  console.log("[baileys] creating socket");
  console.log("[baileys] session dir:", sessionDir);

  await mkdir(sessionDir, { recursive: true });
  await assertSessionDirWritable(sessionDir);
  if (shouldUseQrSafeMode && hasStoredPairingQr) {
    pairingPending = true;
    await saveWhatsappSession({
      status: WhatsappStatus.qr,
      connectedPhone: null,
      lastError: null
    });
    console.log("[baileys] preserving qr while restarting pairing socket");
  } else {
    await saveWhatsappSession({
      status: WhatsappStatus.connecting,
      qrCode: null,
      connectedPhone: null,
      lastError: null
    });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const cleanPairingProfile = isCleanPairing ? getCleanPairingProfile() : null;
  let socketModeOptions: Partial<Parameters<typeof makeWASocket>[0]> = {};

  if (cleanPairingProfile) {
    console.log("[baileys] qr safe profile selected", {
      profileId: cleanPairingProfile.id,
      versionMode: cleanPairingProfile.versionMode,
      browserLabel: cleanPairingProfile.browserLabel
    });

    if (cleanPairingProfile.versionMode === "latest") {
      const { version, isLatest, error: versionError } = await fetchLatestBaileysVersion();

      console.log("[baileys] fetched latest version", {
        version: version.join("."),
        isLatest,
        error: versionError ? sanitizeErrorMessage(versionError) : null
      });

      socketModeOptions = {
        version
      };
    } else {
      console.log("[baileys] latest version skipped for qr safe mode");
    }

    console.log("[baileys] qr safe mode enabled", {
      sessionFiles: sessionFileCount,
      syncFullHistory: false,
      versionSource: cleanPairingProfile.versionMode
    });
  } else {
    console.log("[baileys] normal socket mode enabled", { sessionFiles: sessionFileCount });
    const { version, isLatest, error: versionError } = await fetchLatestBaileysVersion();

    console.log("[baileys] fetched latest version", {
      version: version.join("."),
      isLatest,
      error: versionError ? sanitizeErrorMessage(versionError) : null
    });

    socketModeOptions = {
      version,
      getMessage: getStoredMessage
    };
  }

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: process.env.BAILEYS_LOG_LEVEL ?? "silent" }),
    browser: cleanPairingProfile ? cleanPairingProfile.browser() : Browsers.macOS("Desktop"),
    syncFullHistory: !isCleanPairing,
    shouldSyncHistoryMessage: () => !isCleanPairing,
    markOnlineOnConnect: false,
    ...socketModeOptions
  });

  socket = sock;
  scheduleQrTimeout();

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messaging-history.set", (event) => {
    void syncMessagingHistorySet(event).catch((error) => logAsyncHandlerError("sync history set", error));
  });
  sock.ev.on("chats.upsert", (event) => {
    void syncChatsUpsert(event).catch((error) => logAsyncHandlerError("sync chats upsert", error));
  });
  sock.ev.on("chats.update", (event) => {
    void syncChatsUpdate(event).catch((error) => logAsyncHandlerError("sync chats update", error));
  });
  sock.ev.on("contacts.upsert", (event) => {
    void syncContactsUpsert(event).catch((error) => logAsyncHandlerError("sync contacts upsert", error));
  });
  sock.ev.on("contacts.update", (event) => {
    void syncContactsUpdate(event).catch((error) => logAsyncHandlerError("sync contacts update", error));
  });
  sock.ev.on("messages.upsert", (event) => {
    void handleIncomingMessages(event).catch((error) => logAsyncHandlerError("baileys opt-out", error));
    void syncMessagesUpsert(event).catch((error) => logAsyncHandlerError("sync messages upsert", error));
  });
  sock.ev.on("messages.update", (event) => {
    void syncMessagesUpdate(event).catch((error) => logAsyncHandlerError("sync messages update", error));
  });
  sock.ev.on("labels.edit", (label) => {
    void syncLabelsEdit(label).catch((error) => logAsyncHandlerError("sync labels edit", error));
  });
  sock.ev.on("labels.association", (event) => {
    void syncLabelsAssociation(event).catch((error) => logAsyncHandlerError("sync labels association", error));
  });

  sock.ev.on("connection.update", (update) => {
    void (async () => {
      if (localGeneration !== socketGeneration) {
        console.log("[baileys] stale connection update ignored");
        return;
      }

      const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
      const lastDisconnectError = update.lastDisconnect?.error
        ? sanitizeErrorMessage(update.lastDisconnect.error)
        : null;

      console.log("[baileys] connection.update", {
        connection: update.connection ?? null,
        hasQr: Boolean(update.qr),
        statusCode,
        error: lastDisconnectError
      });

      if (update.qr) {
        clearQrTimeoutTimer();
        hasReceivedQr = true;
        pairingPending = true;
        resetReconnectCounters();
        const qrCode = await QRCode.toDataURL(update.qr);
        await saveWhatsappSession({
          status: WhatsappStatus.qr,
          qrCode,
          connectedPhone: null,
          lastError: null
        });
        console.log("[baileys] qr received and saved");
        console.log("[baileys] pairing pending after qr saved");
        if (cleanPairingProfile) {
          console.log("[baileys] qr generated with safe profile", {
            profileId: cleanPairingProfile.id
          });
        }
      }

      if (update.connection === "open") {
        clearQrTimeoutTimer();
        resetReconnectCounters();
        resetCleanPairingProfiles();
        lastTerminalErrorAt = null;
        manualDisconnectRequested = false;
        pairingPending = false;
        const connectedPhone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
        await saveWhatsappSession({
          status: WhatsappStatus.connected,
          qrCode: null,
          connectedPhone,
          lastError: null
        });
        console.log("[baileys] connected", {
          connectedPhone: connectedPhone ? "present" : "unknown"
        });
      }

      if (update.connection === "close") {
        clearQrTimeoutTimer();
        const isStatus405BeforeQr = statusCode === 405 && !hasReceivedQr;

        socket = null;
        startPromise = null;

        if (manualDisconnectRequested) {
          await saveWhatsappSession({
            status: WhatsappStatus.disconnected,
            qrCode: null,
            connectedPhone: null,
            lastError: null
          });
          console.log("[baileys] connection closed after manual disconnect");
          return;
        }

        const currentSession = await getWhatsappStatus();
        const isDbPairingPendingNow = isPairingPendingSession(currentSession);
        const hasStoredPairingQr = Boolean(currentSession.qrCode) && !currentSession.connectedPhone;
        const shouldPreserveQrDuringPairing =
          (pairingPending || isDbPairingPendingNow) && hasStoredPairingQr;
        const shouldRestartInPairingMode =
          isCleanPairing || pairingPending || isDbPairingPendingNow;

        if (statusCode === 428 || isTerminalSessionStatusCode(statusCode)) {
          if (statusCode === 428 && shouldPreserveQrDuringPairing) {
            clearReconnectTimer();
            await saveWhatsappSession({
              status: WhatsappStatus.qr,
              connectedPhone: null,
              lastError: "Conexao fechou durante o pareamento; QR preservado."
            });
            console.log("[baileys] 428 during pairing; preserving qr state");
            return;
          }

          clearReconnectTimer();
          lastTerminalErrorAt = Date.now();
          const isCleanPairing428 = statusCode === 428 && isCleanPairing;
          const lastError =
            isCleanPairing428
              ? QR_SAFE_428_MESSAGE
              : statusCode === 428
              ? TERMINAL_SESSION_MESSAGE
              : lastDisconnectError ?? TERMINAL_SESSION_MESSAGE;

          await saveWhatsappSession({
            status: isCleanPairing428 ? WhatsappStatus.error : WhatsappStatus.disconnected,
            qrCode: null,
            connectedPhone: null,
            lastError
          });

          if (isCleanPairing428) {
            console.log("[baileys] clean pairing failed with 428");
          } else if (statusCode === 428) {
            console.log("[baileys] connection terminated 428; reconnect disabled");
          } else {
            console.log("[baileys] connection terminated; reconnect disabled", { statusCode });
          }

          return;
        }

        if (isStatus405BeforeQr) {
          const lastError =
            "Baileys fechou com status 405 antes de gerar QR. Possivel sessao corrompida ou versao WhatsApp Web incompativel.";

          if (isCleanPairing) {
            invalidateSocketHandlers();
            const nextProfile = advanceCleanPairingProfile();

            if (nextProfile) {
              if (shouldPreserveQrDuringPairing) {
                await saveWhatsappSession({
                  status: WhatsappStatus.qr,
                  connectedPhone: null,
                  lastError: null
                });
              } else {
                await saveWhatsappSession({
                  status: WhatsappStatus.disconnected,
                  qrCode: null,
                  connectedPhone: null,
                  lastError
                });
              }
              console.warn("[baileys] status 405 before qr; trying next qr safe profile", {
                currentProfile: cleanPairingProfile?.id ?? null,
                nextProfile: nextProfile.id
              });
              scheduleReconnect(1500, "status-405-next-qr-safe-profile");
              return;
            }

            if (shouldPreserveQrDuringPairing) {
              clearReconnectTimer();
              resetCleanPairingProfiles();
              await saveWhatsappSession({
                status: WhatsappStatus.qr,
                connectedPhone: null,
                lastError: "Perfil seguro falhou apos QR salvo; QR preservado."
              });
              console.warn("[baileys] status 405 during pairing; preserving qr state");
              return;
            }

            clearReconnectTimer();
            lastTerminalErrorAt = Date.now();
            resetCleanPairingProfiles();
            await saveWhatsappSession({
              status: WhatsappStatus.error,
              qrCode: null,
              connectedPhone: null,
              lastError: QR_SAFE_405_EXHAUSTED_MESSAGE
            });
            console.log("[baileys] clean pairing failed; all qr safe profiles exhausted");
            return;
          }

          if (connectRetryCount < 1) {
            connectRetryCount += 1;
            await saveWhatsappSession({
              status: WhatsappStatus.disconnected,
              qrCode: null,
              connectedPhone: null,
              lastError
            });
            console.warn("[baileys] status 405 before qr, retrying once", {
              retry: connectRetryCount
            });
            scheduleReconnect(3000, "status-405-before-qr");
            return;
          }

          clearReconnectTimer();
          lastTerminalErrorAt = Date.now();
          await saveWhatsappSession({
            status: WhatsappStatus.error,
            qrCode: null,
            connectedPhone: null,
            lastError
          });
          console.log("[baileys] connection terminated; reconnect disabled", { statusCode: 405 });
          return;
        }

        if (statusCode === DisconnectReason.restartRequired) {
          const lastError = lastDisconnectError ?? "Restart necessario";

          if (shouldRestartInPairingMode) {
            pairingPending = true;

            if (status515RestartCount < 1) {
              status515RestartCount += 1;
              await saveWhatsappSession({
                status: shouldPreserveQrDuringPairing
                  ? WhatsappStatus.qr
                  : WhatsappStatus.connecting,
                connectedPhone: null,
                lastError: null
              });
              console.warn("[baileys] status 515 during pairing; restarting in qr safe mode", {
                retry: status515RestartCount
              });
              scheduleReconnect(3000, "status-515-pairing-restart");
              return;
            }

            if (shouldPreserveQrDuringPairing) {
              clearReconnectTimer();
              await saveWhatsappSession({
                status: WhatsappStatus.qr,
                connectedPhone: null,
                lastError: "Restart repetido durante pareamento; QR preservado."
              });
              console.log("[baileys] repeated 515 during pairing; preserving qr state");
              return;
            }
          }

          if (status515RestartCount < 1) {
            status515RestartCount += 1;
            await saveWhatsappSession({
              status: WhatsappStatus.disconnected,
              qrCode: null,
              connectedPhone: null,
              lastError
            });
            console.warn("[baileys] status 515, restarting once", {
              retry: status515RestartCount
            });
            scheduleReconnect(3000, "status-515-restart");
            return;
          }

          clearReconnectTimer();
          lastTerminalErrorAt = Date.now();
          await saveWhatsappSession({
            status: WhatsappStatus.error,
            qrCode: null,
            connectedPhone: null,
            lastError: "Restart repetido; use Resetar sessao e Reconectar."
          });
          console.log("[baileys] connection terminated; reconnect disabled", { statusCode: 515 });
          return;
        }

        const lastError = lastDisconnectError ?? "Conexao encerrada";

        await saveWhatsappSession({
          status: WhatsappStatus.disconnected,
          qrCode: null,
          connectedPhone: null,
          lastError
        });
        console.warn("[baileys] connection closed", {
          statusCode,
          lastError
        });

        if (generalReconnectCount >= MAX_GENERAL_RECONNECT_ATTEMPTS) {
          clearReconnectTimer();
          lastTerminalErrorAt = Date.now();
          await saveWhatsappSession({
            status: WhatsappStatus.error,
            qrCode: null,
            connectedPhone: null,
            lastError: "Limite de reconexao automatico atingido."
          });
          console.log("[baileys] connection terminated; reconnect disabled", {
            statusCode,
            reason: "max-reconnect"
          });
          return;
        }

        generalReconnectCount += 1;
        const backoffMs = Math.min(5000 * generalReconnectCount, 30_000);
        scheduleReconnect(backoffMs, "connection-close");
      }
    })();
  });

  return sock;
}

export async function startBaileysConnection(options: { resetRetry?: boolean } = {}) {
  const shouldResetRetry = options.resetRetry ?? true;

  if (resetInProgress) {
    console.log("[baileys] start skipped; reset in progress");
    throw new BaileysStartSkippedError("Reset em andamento");
  }

  if (
    lastTerminalErrorAt !== null &&
    Date.now() - lastTerminalErrorAt < TERMINAL_COOLDOWN_MS
  ) {
    console.log("[baileys] start skipped; terminal failure cooldown active");
    throw new BaileysStartSkippedError(
      "Aguarde alguns segundos apos erro terminal antes de reconectar"
    );
  }

  if (reconnectTimer) {
    console.log("[baileys] start skipped; reconnect already scheduled");
    if (startPromise) {
      return startPromise;
    }
    throw new BaileysStartSkippedError("Reconnect ja agendado");
  }

  if (startPromise) {
    console.log("[baileys] start skipped; socket already starting");
    return startPromise;
  }

  if (socket) {
    console.log("[baileys] start skipped; socket already exists");
    return socket;
  }

  const sessionFileCount = await countSessionFiles();
  console.log("[baileys] session files before start", { files: sessionFileCount });
  const dbSession = await getWhatsappStatus();
  const hasConnectedPhone = Boolean(dbSession.connectedPhone);
  const isDbPairingPending = isPairingPendingSession(dbSession);
  const hasStoredPairingQr = Boolean(dbSession.qrCode) && !dbSession.connectedPhone;
  const isCleanSession = sessionFileCount === 0;
  const shouldUseQrSafeMode = isCleanSession || isDbPairingPending || pairingPending;

  console.log("[baileys] pairing mode decision", {
    sessionFiles: sessionFileCount,
    dbStatus: dbSession.status,
    hasConnectedPhone,
    hasStoredPairingQr,
    isCleanSession,
    isDbPairingPending,
    internalPairingPending: pairingPending,
    shouldUseQrSafeMode
  });

  if (
    lastResetSucceededAt !== null &&
    Date.now() - lastResetSucceededAt < 60_000 &&
    sessionFileCount > 0 &&
    !shouldUseQrSafeMode
  ) {
    const lastError = "Sessao nao foi limpa corretamente apos reset.";
    console.log("[baileys] start failed with terminal status", { lastError, sessionFileCount });
    await saveWhatsappSession({
      status: WhatsappStatus.error,
      qrCode: null,
      connectedPhone: null,
      lastError
    });
    throw new Error(lastError);
  }

  if (shouldResetRetry) {
    resetReconnectCounters();
  }

  manualDisconnectRequested = false;

  startPromise = createSocket({
    sessionFileCount,
    shouldUseQrSafeMode,
    hasStoredPairingQr
  })
    .catch(async (error) => {
      startPromise = null;
      const lastError = sanitizeErrorMessage(error) || "Erro ao iniciar Baileys";
      console.log("[baileys] start failed with terminal status", { lastError });
      if (shouldUseQrSafeMode && hasStoredPairingQr) {
        await saveWhatsappSession({
          status: WhatsappStatus.qr,
          connectedPhone: null,
          lastError: "Falha ao reiniciar pareamento; QR preservado."
        });
        throw error;
      }

      await saveWhatsappSession({
        status: WhatsappStatus.error,
        qrCode: null,
        connectedPhone: null,
        lastError
      });
      throw error;
    })
    .finally(() => {
      startPromise = null;
    });

  return startPromise;
}

export async function getWhatsappStatus() {
  const session = await prisma.whatsappSession.findUnique({
    where: {
      id: SESSION_ID
    }
  });

  return (
    session ?? {
      id: SESSION_ID,
      status: WhatsappStatus.disconnected,
      qrCode: null,
      connectedPhone: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  );
}

export async function getWhatsappStatusPayload() {
  const session = await getWhatsappStatus();

  return {
    id: session.id,
    status: session.status,
    qrCode: session.qrCode,
    hasQrCode: Boolean(session.qrCode),
    connectedPhone: session.connectedPhone,
    lastError: session.lastError,
    updatedAt: session.updatedAt
  };
}

export async function markWhatsappConnecting() {
  await saveWhatsappSession({
    status: WhatsappStatus.connecting,
    qrCode: null,
    connectedPhone: null,
    lastError: null
  });
}

export async function markWhatsappDisconnected() {
  await saveWhatsappSession({
    status: WhatsappStatus.disconnected,
    qrCode: null,
    connectedPhone: null,
    lastError: null
  });
}

export async function markWhatsappError(lastError: string) {
  await saveWhatsappSession({
    status: WhatsappStatus.error,
    qrCode: null,
    connectedPhone: null,
    lastError
  });
}

export async function disconnectBaileys() {
  manualDisconnectRequested = true;
  invalidateSocketHandlers();
  clearReconnectTimer();
  clearQrTimeoutTimer();
  resetReconnectCounters();
  pairingPending = false;
  startPromise = null;

  if (socket) {
    await socket.logout().catch(() => undefined);
    socket.end(new Error("Disconnect manual"));
    socket = null;
  }

  await saveWhatsappSession({
    status: WhatsappStatus.disconnected,
    qrCode: null,
    connectedPhone: null,
    lastError: null
  });
}

export async function resetBaileysSession() {
  if (resetInProgress) {
    console.log("[baileys] reset skipped; already in progress");
    return;
  }

  resetInProgress = true;
  console.log("[baileys] reset session requested");

  try {
    manualDisconnectRequested = true;
    invalidateSocketHandlers();
    clearReconnectTimer();
    clearQrTimeoutTimer();
    resetReconnectCounters();
    resetCleanPairingProfiles({ log: true });
    hasReceivedQr = false;
    pairingPending = false;
    startPromise = null;
    lastTerminalErrorAt = null;

    if (socket) {
      socket.end(new Error("Reset manual da sessao Baileys"));
      socket = null;
    }

    await clearSessionDir();
    const remainingFiles = await countSessionFiles();
    console.log("[baileys] session files removed", { remainingFiles });

    if (remainingFiles > 0) {
      lastResetSucceededAt = null;
      await saveWhatsappSession({
        status: WhatsappStatus.error,
        qrCode: null,
        connectedPhone: null,
        lastError: "Falha ao limpar arquivos da sessao Baileys."
      });
      return;
    }

    lastResetSucceededAt = Date.now();
    await saveWhatsappSession({
      status: WhatsappStatus.disconnected,
      qrCode: null,
      connectedPhone: null,
      lastError: null
    });
  } finally {
    resetInProgress = false;
    manualDisconnectRequested = false;
  }
}

export async function requestWhatsappHistorySync() {
  const session = await getWhatsappStatus();

  if (session.status !== WhatsappStatus.connected) {
    console.log("[baileys] history sync skipped; not connected", {
      status: session.status
    });

    return {
      ok: false,
      mode: "event-driven" as const,
      message: "WhatsApp nao esta conectado. Reconecte primeiro."
    };
  }

  console.log("[baileys] history sync requested", {
    syncFullHistory: false,
    hasOnDemandHistory: false,
    mode: "event-driven"
  });

  return {
    ok: true,
    mode: "event-driven" as const,
    message:
      "O WhatsApp envia historico por eventos proprios. Historico antigo completo nao e solicitado durante pareamento."
  };
}

async function getConnectedSocket() {
  await startBaileysConnection();

  const deadline = Date.now() + 20_000;
  let session = await getWhatsappStatus();

  while (session.status === WhatsappStatus.connecting && Date.now() < deadline) {
    await sleep(500);
    session = await getWhatsappStatus();
  }

  if (session.status !== WhatsappStatus.connected || !socket) {
    const reason =
      session.status === WhatsappStatus.qr
        ? "WhatsApp aguardando leitura do QR Code"
        : session.lastError || `WhatsApp nao conectado: ${session.status}`;
    throw new Error(reason);
  }

  return socket;
}

export async function sendWhatsappMessageToJid(jid: string, text: string) {
  const normalizedJid = normalizeChatJid(jid);
  const messageText = text.trim();

  if (!normalizedJid) {
    throw new Error("JID de destino invalido");
  }

  if (!messageText) {
    throw new Error("Mensagem vazia");
  }

  const activeSocket = await getConnectedSocket();
  const sentMessage = await activeSocket.sendMessage(normalizedJid, {
    text: messageText
  });

  return {
    waMessageId: sentMessage?.key?.id ?? null,
    senderJid: normalizeChatJid(activeSocket.user?.id),
    rawJson: {
      key: {
        id: sentMessage?.key?.id ?? null,
        remoteJid: sentMessage?.key?.remoteJid ?? normalizedJid,
        fromMe: sentMessage?.key?.fromMe ?? true
      },
      messageTimestamp: getMessageTimestampForJson(sentMessage?.messageTimestamp ?? null),
      status: sentMessage?.status ?? null
    }
  };
}

export async function sendWhatsappMessage(phoneNormalized: string, message: string) {
  await sendWhatsappMessageToJid(toWhatsappJid(phoneNormalized), message);
}
