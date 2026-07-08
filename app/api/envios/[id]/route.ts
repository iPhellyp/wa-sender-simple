import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLidJid(value: string | null | undefined) {
  return Boolean(value?.trim().toLowerCase().endsWith("@lid"));
}

function phoneFromJid(value: string | null | undefined) {
  const jid = value?.trim().toLowerCase() ?? "";

  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@c.us")) {
    return "";
  }

  return jid.split("@")[0]?.split(":")[0]?.replace(/\D/g, "") ?? "";
}

function formatPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";

  if (!digits) {
    return "";
  }

  if (digits.startsWith("55") && digits.length >= 12) {
    const national = digits.slice(2);
    const areaCode = national.slice(0, 2);
    const subscriber = national.slice(2);

    if (subscriber.length === 9) {
      return `+55 (${areaCode}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`;
    }

    if (subscriber.length === 8) {
      return `+55 (${areaCode}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
    }
  }

  return `+${digits}`;
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function safeName(value: string | null | undefined) {
  const text = value?.trim() ?? "";

  if (!text || text.includes("@")) {
    return "";
  }

  return text;
}

function isGenericWhatsappChatName(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return !normalized || /^Contato WhatsApp\s+\S+$/i.test(normalized) || normalized.endsWith("@lid");
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);

  const campaign = await prisma.campaign.findFirst({
    where: {
      id,
      instanceId
    },
    include: {
      targetLabel: {
        select: {
          id: true,
          name: true,
          color: true
        }
      },
      recipients: {
        where: {
          instanceId
        },
        orderBy: {
          createdAt: "asc"
        },
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phoneNormalized: true,
              optedOut: true
            }
          }
        }
      }
    }
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campanha nao encontrada" }, { status: 404 });
  }

  const jids = Array.from(
    new Set(campaign.recipients.map((recipient) => recipient.jid?.trim()).filter((jid): jid is string => Boolean(jid)))
  );
  const chatIds = Array.from(
    new Set(
      campaign.recipients.map((recipient) => recipient.chatId?.trim()).filter((chatId): chatId is string => Boolean(chatId))
    )
  );
  const [whatsappContacts, whatsappChatsByJid, whatsappChatsById] = await Promise.all([
    jids.length
      ? prisma.whatsappContact.findMany({
          where: {
            instanceId,
            jid: {
              in: jids
            }
          },
          select: {
            jid: true,
            phone: true,
            name: true,
            pushName: true
          }
        })
      : Promise.resolve([]),
    jids.length
      ? prisma.whatsappChat.findMany({
          where: {
            instanceId,
            jid: {
              in: jids
            }
          },
          select: {
            id: true,
            jid: true,
            name: true
          }
        })
      : Promise.resolve([]),
    chatIds.length
      ? prisma.whatsappChat.findMany({
          where: {
            instanceId,
            id: {
              in: chatIds
            }
          },
          select: {
            id: true,
            jid: true,
            name: true
          }
        })
      : Promise.resolve([])
  ]);
  const whatsappContactByJid = new Map(whatsappContacts.map((contact) => [contact.jid, contact]));
  const whatsappChatByJid = new Map(whatsappChatsByJid.map((chat) => [chat.jid, chat]));
  const whatsappChatById = new Map(whatsappChatsById.map((chat) => [chat.id, chat]));
  const recipients = campaign.recipients.map((recipient) => {
    const jid = recipient.jid ?? "";
    const whatsappContact = whatsappContactByJid.get(jid);
    const whatsappChat = whatsappChatById.get(recipient.chatId ?? "") ?? whatsappChatByJid.get(jid);
    const formattedWhatsappPhone = formatPhone(whatsappContact?.phone);
    const formattedContactPhone = formatPhone(recipient.contact?.phoneNormalized);
    const formattedJidPhone = formatPhone(phoneFromJid(jid));
    const safeChatName = isGenericWhatsappChatName(whatsappChat?.name) ? "" : safeName(whatsappChat?.name);
    const displayName =
      firstText(
        safeName(recipient.contact?.name),
        safeName(whatsappContact?.name),
        safeName(whatsappContact?.pushName),
        formattedWhatsappPhone,
        safeChatName,
        formattedContactPhone,
        formattedJidPhone
      ) || (isLidJid(jid) ? "Contato sem numero resolvido" : jid || recipient.id);
    const displayPhone = firstText(formattedWhatsappPhone, formattedContactPhone, formattedJidPhone) || null;
    const displaySubtitle =
      displayPhone || (isLidJid(jid) ? `lid: ${jid}` : jid ? `JID: ${jid}` : "Sem identificador");

    return {
      ...recipient,
      rawJid: jid || null,
      displayName,
      displayPhone,
      displaySubtitle
    };
  });

  return NextResponse.json({
    campaign: {
      ...campaign,
      recipients
    }
  });
}
