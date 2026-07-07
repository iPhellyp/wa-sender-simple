import { prisma } from "../prisma/client";

export type BulkContactLabelResult = {
  updatedLocal: number;
  queuedForWhatsapp: number;
  skippedNoChat: number;
  jids: string[];
};

function jidMatchesPhone(jid: string, phone: string) {
  return jid.startsWith(phone) || jid.includes(`${phone}@`) || jid.includes(`${phone}:`);
}

export async function applyLocalContactLabel(params: {
  contactIds: string[];
  labelName: string;
}) {
  const contactIds = Array.from(new Set(params.contactIds.filter(Boolean))).slice(0, 500);
  const labelName = params.labelName.trim();

  if (!labelName) {
    throw new Error("Etiqueta obrigatoria");
  }

  const contacts = await prisma.contact.findMany({
    where: {
      id: {
        in: contactIds
      }
    },
    select: {
      id: true,
      phoneNormalized: true
    }
  });
  const phones = contacts.map((contact) => contact.phoneNormalized).filter(Boolean);
  const chats = phones.length
    ? await prisma.whatsappChat.findMany({
        where: {
          isGroup: false,
          OR: phones.map((phone) => ({
            jid: {
              contains: phone
            }
          }))
        },
        select: {
          jid: true
        }
      })
    : [];
  const matchedJids = new Set<string>();

  for (const contact of contacts) {
    const chat = chats.find((item) => jidMatchesPhone(item.jid, contact.phoneNormalized));

    if (chat) {
      matchedJids.add(chat.jid);
    }
  }

  const updated = await prisma.contact.updateMany({
    where: {
      id: {
        in: contacts.map((contact) => contact.id)
      }
    },
    data: {
      source: labelName
    }
  });

  return {
    updatedLocal: updated.count,
    queuedForWhatsapp: matchedJids.size,
    skippedNoChat: Math.max(0, contacts.length - matchedJids.size),
    jids: Array.from(matchedJids)
  } satisfies BulkContactLabelResult;
}
