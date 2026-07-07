import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";
import { getWhatsappDisplayName } from "@/src/lib/whatsapp/display-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";

  const label = await prisma.whatsappLabel.findFirst({
    where: {
      id,
      deleted: false
    }
  });

  if (!label) {
    return NextResponse.json({ error: "Etiqueta nao encontrada" }, { status: 404 });
  }

  const associations = await prisma.whatsappChatLabel.findMany({
    where: {
      labelId: label.id,
      chat: {
        isGroup: false
      }
    },
    include: {
      chat: true
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  const chatJids = associations.map((item) => item.chat.jid);
  const contacts = chatJids.length
    ? await prisma.whatsappContact.findMany({
        where: {
          jid: {
            in: chatJids
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

  const conversations = associations
    .map((association) => {
      const chat = association.chat;
      const contact = contactByJid.get(chat.jid);
      const name = getWhatsappDisplayName({
        jid: chat.jid,
        chatName: chat.name,
        contactName: contact?.name,
        contactPushName: contact?.pushName,
        isGroup: chat.isGroup
      });
      const haystack = `${name} ${chat.jid} ${chat.lastMessageText ?? ""}`.toLowerCase();

      if (search && !haystack.includes(search.toLowerCase())) {
        return null;
      }

      return {
        chatId: chat.id,
        jid: chat.jid,
        name,
        isGroup: chat.isGroup,
        lastMessageAt: chat.lastMessageAt,
        lastMessageText: chat.lastMessageText
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const contactCount = associations.length;
  const groupCount = await prisma.whatsappChatLabel.count({
    where: {
      labelId: label.id,
      chat: {
        isGroup: true
      }
    }
  });

  return NextResponse.json({
    label: {
      id: label.id,
      waLabelId: label.waLabelId,
      name: label.name,
      color: label.color,
      predefined: label.predefined,
      updatedAt: label.updatedAt
    },
    metrics: {
      conversationCount: contactCount,
      contactCount,
      groupCount
    },
    conversations
  });
}
