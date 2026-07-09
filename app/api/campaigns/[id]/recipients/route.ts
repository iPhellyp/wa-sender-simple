import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";
import { resolveContactDisplay } from "@/src/lib/whatsapp/contact-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const chatIds = Array.from(
    new Set(
      recipients.map((recipient) => recipient.chatId?.trim()).filter((chatId): chatId is string => Boolean(chatId))
    )
  );
  const [whatsappContacts, whatsappChats, whatsappChatsById] = await Promise.all([
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
  const whatsappChatByJid = new Map(whatsappChats.map((chat) => [chat.jid, chat]));
  const whatsappChatById = new Map(whatsappChatsById.map((chat) => [chat.id, chat]));

  return NextResponse.json({
    recipients: recipients.map((recipient) => {
      const jid = recipient.jid ?? "";
      const whatsappContact = whatsappContactByJid.get(jid);
      const whatsappChat = whatsappChatById.get(recipient.chatId ?? "") ?? whatsappChatByJid.get(jid);
      const effectiveJid = jid || whatsappChat?.jid || "";
      const display = resolveContactDisplay({
        jid: effectiveJid,
        contactName: recipient.contact?.name,
        phoneRaw: recipient.contact?.phoneRaw,
        phoneNormalized: recipient.contact?.phoneNormalized,
        chatName: whatsappChat?.name,
        name: whatsappContact?.name,
        pushName: whatsappContact?.pushName,
        phone: whatsappContact?.phone
      });

      return {
        ...recipient,
        ...display
      };
    })
  });
}
