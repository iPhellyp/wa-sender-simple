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

const SESSION_ID = "default";

let socket: WASocket | null = null;
let startPromise: Promise<WASocket> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let qrTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
let manualDisconnectRequested = false;
let hasReceivedQr = false;
let connectRetryCount = 0;

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
}

function scheduleReconnect(delayMs: number, reason: string) {
  if (manualDisconnectRequested) {
    console.log("[baileys] reconnect skipped after manual disconnect", { reason });
    return;
  }

  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startBaileysConnection({ resetRetry: false });
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

async function createSocket() {
  const sessionDir = getSessionDir();
  clearReconnectTimer();
  hasReceivedQr = false;
  console.log("[baileys] creating socket");
  console.log("[baileys] session dir:", sessionDir);

  await mkdir(sessionDir, { recursive: true });
  await assertSessionDirWritable(sessionDir);
  await saveWhatsappSession({
    status: WhatsappStatus.connecting,
    qrCode: null,
    connectedPhone: null,
    lastError: null
  });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version, isLatest, error: versionError } = await fetchLatestBaileysVersion();

  console.log("[baileys] fetched latest version", {
    version: version.join("."),
    isLatest,
    error: versionError ? sanitizeErrorMessage(versionError) : null
  });

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: P({ level: process.env.BAILEYS_LOG_LEVEL ?? "silent" }),
    browser: Browsers.macOS("Desktop"),
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    getMessage: getStoredMessage,
    markOnlineOnConnect: false
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

  sock.ev.on("connection.update", (update) => {
    void (async () => {
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
        connectRetryCount = 0;
        const qrCode = await QRCode.toDataURL(update.qr);
        await saveWhatsappSession({
          status: WhatsappStatus.qr,
          qrCode,
          lastError: null
        });
        console.log("[baileys] qr received and saved");
      }

      if (update.connection === "open") {
        clearQrTimeoutTimer();
        connectRetryCount = 0;
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
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        const lastError = isStatus405BeforeQr
          ? "Baileys fechou com status 405 antes de gerar QR. Possivel sessao corrompida ou versao WhatsApp Web incompativel."
          : lastDisconnectError ?? "Conexao encerrada";

        socket = null;

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

        await saveWhatsappSession({
          status: isStatus405BeforeQr && connectRetryCount >= 1
            ? WhatsappStatus.error
            : shouldReconnect
              ? WhatsappStatus.disconnected
              : WhatsappStatus.error,
          qrCode: null,
          connectedPhone: null,
          lastError
        });
        console.warn("[baileys] connection closed", {
          statusCode,
          shouldReconnect,
          lastError
        });

        if (isStatus405BeforeQr) {
          if (connectRetryCount < 1) {
            connectRetryCount += 1;
            console.warn("[baileys] status 405 before qr, retrying once", {
              retry: connectRetryCount
            });
            scheduleReconnect(3000, "status-405-before-qr");
          }
          return;
        }

        if (shouldReconnect) {
          scheduleReconnect(5000, "connection-close");
        }
      }
    })();
  });

  return sock;
}

export async function startBaileysConnection(options: { resetRetry?: boolean } = {}) {
  const shouldResetRetry = options.resetRetry ?? true;
  manualDisconnectRequested = false;

  if (shouldResetRetry) {
    connectRetryCount = 0;
  }

  if (socket) {
    return socket;
  }

  if (!startPromise) {
    startPromise = createSocket()
      .catch(async (error) => {
        const lastError = sanitizeErrorMessage(error) || "Erro ao iniciar Baileys";
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
  }

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
  clearReconnectTimer();
  clearQrTimeoutTimer();

  if (socket) {
    await socket.logout().catch(() => undefined);
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
  manualDisconnectRequested = true;
  clearReconnectTimer();
  clearQrTimeoutTimer();
  connectRetryCount = 0;
  hasReceivedQr = false;

  if (socket) {
    socket.end(new Error("Reset manual da sessao Baileys"));
    socket = null;
  }

  startPromise = null;
  await clearSessionDir();

  await saveWhatsappSession({
    status: WhatsappStatus.disconnected,
    qrCode: null,
    connectedPhone: null,
    lastError: null
  });
}

export async function requestWhatsappHistorySync() {
  await startBaileysConnection();

  const hasOnDemandHistory = typeof socket?.fetchMessageHistory === "function";
  console.log("[baileys] history sync requested", {
    syncFullHistory: true,
    hasOnDemandHistory,
    mode: "event-driven"
  });

  return {
    ok: true,
    hasOnDemandHistory,
    message:
      "Sync full history esta configurado. A chegada de historico depende dos eventos do WhatsApp; fetchMessageHistory exige cursor de mensagem e nao foi executado sem referencia segura."
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
