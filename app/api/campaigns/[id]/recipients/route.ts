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

  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }

  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return digits;
}

function isGenericWhatsappChatName(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  return !normalized || /^Contato WhatsApp\s+\S+$/i.test(normalized) || normalized.endsWith("@lid");
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function safeName(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";

  return isLidJid(normalized) ? "" : normalized;
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      instanceId,
      campaignId: id
    },
    include: {
      contact: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const jids = Array.from(
    new Set(recipients.map((recipient) => recipient.jid?.trim()).filter(Boolean))
  ) as string[];
  const [whatsappContacts, whatsappChats] = await Promise.all([
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
            name: true,
            pushName: true,
            phone: true
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
            jid: true,
            name: true
          }
        })
      : Promise.resolve([])
  ]);
  const whatsappContactByJid = new Map(whatsappContacts.map((contact) => [contact.jid, contact]));
  const whatsappChatByJid = new Map(whatsappChats.map((chat) => [chat.jid, chat]));

  return NextResponse.json({
    recipients: recipients.map((recipient) => {
      const jid = recipient.jid ?? "";
      const whatsappContact = whatsappContactByJid.get(jid);
      const whatsappChat = whatsappChatByJid.get(jid);
      const formattedWhatsappPhone = formatPhone(whatsappContact?.phone);
      const formattedContactPhone = formatPhone(
        recipient.contact?.phoneNormalized || recipient.contact?.phoneRaw
      );
      const formattedJidPhone = formatPhone(phoneFromJid(jid));
      const safeChatName = isGenericWhatsappChatName(whatsappChat?.name) ? "" : safeName(whatsappChat?.name);
      const displayName = firstText(
        safeName(recipient.contact?.name),
        safeName(whatsappContact?.name),
        safeName(whatsappContact?.pushName),
        formattedWhatsappPhone,
        safeChatName,
        formattedContactPhone,
        formattedJidPhone
      ) || (isLidJid(jid) ? "Contato sem numero resolvido" : jid || recipient.id);
      const displayPhone = firstText(
        formattedWhatsappPhone,
        formattedContactPhone,
        formattedJidPhone
      );
      const displaySubtitle =
        displayPhone ||
        (isLidJid(jid) ? `@lid: ${jid}` : jid ? `JID: ${jid}` : "Sem identificador");

      return {
        ...recipient,
        displayName,
        displayPhone,
        displaySubtitle
      };
    })
  });
}
