import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket
} from "@whiskeysockets/baileys";
import { mkdir } from "fs/promises";
import P from "pino";
import QRCode from "qrcode";
import { WhatsappStatus } from "@prisma/client";
import { prisma } from "../prisma/client";
import { normalizeBrazilPhone, toWhatsappJid } from "../phone/normalize";
import { extractMessageText, isOptOutMessage } from "./opt-out";

const SESSION_ID = "default";

let socket: WASocket | null = null;
let startPromise: Promise<WASocket> | null = null;

function getSessionDir() {
  return process.env.BAILEYS_SESSION_DIR ?? "./data/baileys-session";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function handleIncomingMessages(event: {
  messages?: Array<{
    key: {
      fromMe?: boolean | null;
      remoteJid?: string | null;
    };
    message?: unknown;
  }>;
}) {
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
  await mkdir(getSessionDir(), { recursive: true });
  await saveWhatsappSession({
    status: WhatsappStatus.connecting,
    lastError: null
  });

  const { state, saveCreds } = await useMultiFileAuthState(getSessionDir());
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: process.env.BAILEYS_LOG_LEVEL ?? "silent" }),
    browser: ["WA Sender Simple", "Chrome", "1.0.0"]
  });

  socket = sock;

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", (event) => {
    void handleIncomingMessages(event);
  });

  sock.ev.on("connection.update", (update) => {
    void (async () => {
      if (update.qr) {
        const qrCode = await QRCode.toDataURL(update.qr);
        await saveWhatsappSession({
          status: WhatsappStatus.qr,
          qrCode,
          lastError: null
        });
      }

      if (update.connection === "open") {
        const connectedPhone = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
        await saveWhatsappSession({
          status: WhatsappStatus.connected,
          qrCode: null,
          connectedPhone,
          lastError: null
        });
      }

      if (update.connection === "close") {
        const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })
          ?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        socket = null;
        await saveWhatsappSession({
          status: shouldReconnect ? WhatsappStatus.disconnected : WhatsappStatus.error,
          qrCode: null,
          connectedPhone: null,
          lastError: update.lastDisconnect?.error?.message ?? "Conexao encerrada"
        });

        if (shouldReconnect) {
          setTimeout(() => {
            void startBaileysConnection();
          }, 5000);
        }
      }
    })();
  });

  return sock;
}

export async function startBaileysConnection() {
  if (socket) {
    return socket;
  }

  if (!startPromise) {
    startPromise = createSocket()
      .catch(async (error) => {
        await saveWhatsappSession({
          status: WhatsappStatus.error,
          qrCode: null,
          connectedPhone: null,
          lastError: error instanceof Error ? error.message : "Erro ao iniciar Baileys"
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

export async function disconnectBaileys() {
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

export async function sendWhatsappMessage(phoneNormalized: string, message: string) {
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

  await socket.sendMessage(toWhatsappJid(phoneNormalized), {
    text: message
  });
}
