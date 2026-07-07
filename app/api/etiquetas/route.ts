import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const labels = await prisma.whatsappLabel.findMany({
    where: {
      deleted: false
    },
    orderBy: {
      name: "asc"
    },
    include: {
      _count: {
        select: {
          chats: true
        }
      },
      chats: {
        include: {
          chat: {
            select: {
              isGroup: true
            }
          }
        }
      }
    }
  });

  const [activeLabels, contactLabels, groupLabels] = await Promise.all([
    prisma.whatsappLabel.count({
      where: {
        deleted: false
      }
    }),
    prisma.whatsappChatLabel.count({
      where: {
        chat: {
          isGroup: false
        }
      }
    }),
    prisma.whatsappChatLabel.count({
      where: {
        chat: {
          isGroup: true
        }
      }
    })
  ]);

  return NextResponse.json({
    metrics: {
      totalLabels: labels.length,
      activeLabels,
      labeledChats: contactLabels,
      contactLabels,
      eligibleX1Contacts: contactLabels,
      groupLabels
    },
    labels: labels.map((label) => {
      const contactCount = label.chats.filter((item) => !item.chat.isGroup).length;
      const groupCount = label.chats.filter((item) => item.chat.isGroup).length;

      return {
        id: label.id,
        waLabelId: label.waLabelId,
        name: label.name,
        color: label.color,
        predefined: label.predefined,
        deleted: label.deleted,
        conversationCount: label._count.chats,
        contactCount,
        groupCount,
        updatedAt: label.updatedAt
      };
    })
  });
}
