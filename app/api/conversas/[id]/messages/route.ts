import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma/client";
import { getWhatsappDisplayName } from "@/src/lib/whatsapp/display-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 100;

const hiddenMessageTypes = [
  "protocolMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo"
];

const mediaMessageLabels: Record<string, string> = {
  imageMessage: "Imagem recebida",
  videoMessage: "Video recebido",
  audioMessage: "Audio recebido",
  documentMessage: "Documento recebido",
  stickerMessage: "Figurinha recebida",
  contactMessage: "Contato recebido",
  contactsArrayMessage: "Contatos recebidos",
  locationMessage: "Localizacao recebida"
};

function getLimit(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);

  if (!Number.isFinite(rawLimit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT);
}

function getAfterDate(request: NextRequest) {
  const rawAfter = request.nextUrl.searchParams.get("after");

  if (!rawAfter) {
    return null;
  }

  const parsed = new Date(rawAfter);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getVisibleMessageWhere(chatId: string, afterDate: Date | null): Prisma.WhatsappMessageWhereInput {
  return {
    chatId,
    ...(afterDate ? { createdAt: { gt: afterDate } } : {}),
    AND: [
      {
        OR: [
          {
            text: {
              not: null
            }
          },
          {
            messageType: {
              in: Object.keys(mediaMessageLabels)
            }
          }
        ]
      },
      {
        NOT: [
          {
            messageType: {
              in: hiddenMessageTypes
            }
          },
          {
            messageType: null
          },
          {
            messageType: "reactionMessage",
            text: null
          }
        ]
      }
    ]
  };
}

function getVisibleText(message: {
  text: string | null;
  messageType: string | null;
}) {
  if (message.text) {
    return message.text;
  }

  return message.messageType ? mediaMessageLabels[message.messageType] ?? null : null;
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const limit = getLimit(request);
  const before = request.nextUrl.searchParams.get("before");
  const afterDate = getAfterDate(request);

  const chat = await prisma.whatsappChat.findUnique({
    where: {
      id
    },
    select: {
      id: true,
      jid: true,
      isGroup: true
    }
  });

  if (!chat) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  const where = getVisibleMessageWhere(chat.id, afterDate);
  let cursor: { id: string } | undefined;

  if (before) {
    const cursorMessage = await prisma.whatsappMessage.findFirst({
      where: {
        id: before,
        chatId: chat.id
      },
      select: {
        id: true
      }
    });

    if (!cursorMessage) {
      return NextResponse.json({ error: "Cursor de mensagem invalido" }, { status: 400 });
    }

    cursor = { id: cursorMessage.id };
  }

  const rows = await prisma.whatsappMessage.findMany({
    where,
    orderBy: [
      {
        timestamp: {
          sort: "desc",
          nulls: "last"
        }
      },
      {
        createdAt: "desc"
      },
      {
        id: "desc"
      }
    ],
    ...(cursor ? { cursor, skip: 1 } : {}),
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const visibleRows = rows.slice(0, limit).reverse();
  const contactJids = Array.from(
    new Set(
      visibleRows
        .map((message) => message.senderJid ?? (message.fromMe ? null : chat.jid))
        .filter((jid): jid is string => Boolean(jid))
    )
  );
  const contacts = contactJids.length > 0
    ? await prisma.whatsappContact.findMany({
        where: {
          jid: {
            in: contactJids
          }
        },
        select: {
          jid: true,
          name: true,
          pushName: true
        }
      })
    : [];
  const contactByJid = new Map(contacts.map((contact) => [contact.jid, contact]));
  const messages = visibleRows.flatMap((message) => {
    const displayText = getVisibleText(message);
    const senderJid = message.senderJid ?? (message.fromMe ? null : chat.jid);
    const senderContact = senderJid ? contactByJid.get(senderJid) : null;

    if (!displayText) {
      return [];
    }

    return [
      {
        id: message.id,
        jid: message.jid,
        waMessageId: message.waMessageId,
        fromMe: message.fromMe,
        senderJid,
        senderName: senderJid
          ? getWhatsappDisplayName({
              jid: senderJid,
              contactName: senderContact?.name,
              contactPushName: senderContact?.pushName
            })
          : null,
        messageType: message.messageType,
        text: displayText,
        timestamp: message.timestamp?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString()
      }
    ];
  });

  return NextResponse.json({
    chat: {
      id: chat.id,
      jid: chat.jid,
      isGroup: chat.isGroup
    },
    hasMore,
    messages
  });
}

