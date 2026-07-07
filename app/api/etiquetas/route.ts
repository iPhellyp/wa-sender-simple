import { CampaignRecipientStatus } from "@prisma/client";
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
        select: {
          chatId: true,
          updatedAt: true,
          chat: {
            select: {
              isGroup: true
            }
          }
        }
      },
      campaigns: {
        orderBy: {
          updatedAt: "desc"
        },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          updatedAt: true
        }
      }
    }
  });
  const labelIds = labels.map((label) => label.id);
  const [activeLabels, labeledContactRows, contactLabels, groupLabels, eligibleX1Contacts, recipientRows] =
    await Promise.all([
      prisma.whatsappLabel.count({
        where: {
          deleted: false
        }
      }),
      prisma.whatsappChatLabel.findMany({
        distinct: ["chatId"],
        where: {
          chat: {
            isGroup: false
          }
        },
        select: {
          chatId: true
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
      }),
      prisma.whatsappChat.count({
        where: {
          isGroup: false
        }
      }),
      prisma.campaignRecipient.findMany({
        where: {
          campaign: {
            targetLabelId: {
              in: labelIds
            }
          }
        },
        select: {
          status: true,
          campaign: {
            select: {
              targetLabelId: true
            }
          }
        }
      })
    ]);
  const sendStatsByLabel = new Map<
    string,
    {
      sent: number;
      failed: number;
      pending: number;
    }
  >();

  for (const row of recipientRows) {
    const targetLabelId = row.campaign.targetLabelId;

    if (!targetLabelId) {
      continue;
    }

    const stats = sendStatsByLabel.get(targetLabelId) ?? {
      sent: 0,
      failed: 0,
      pending: 0
    };

    if (row.status === CampaignRecipientStatus.sent) {
      stats.sent += 1;
    } else if (row.status === CampaignRecipientStatus.failed) {
      stats.failed += 1;
    } else {
      stats.pending += 1;
    }

    sendStatsByLabel.set(targetLabelId, stats);
  }

  return NextResponse.json({
    metrics: {
      totalLabels: labels.length,
      activeLabels,
      labeledChats: labeledContactRows.length,
      contactLabels,
      eligibleX1Contacts,
      groupLabels
    },
    labels: labels.map((label) => {
      const contactAssociations = label.chats.filter((item) => !item.chat.isGroup);
      const groupAssociations = label.chats.filter((item) => item.chat.isGroup);
      const lastAssociationUpdate = label.chats.reduce<Date | null>(
        (latest, item) => (!latest || item.updatedAt > latest ? item.updatedAt : latest),
        null
      );
      const sendStats = sendStatsByLabel.get(label.id) ?? {
        sent: 0,
        failed: 0,
        pending: 0
      };
      const lastCampaign = label.campaigns[0] ?? null;

      return {
        id: label.id,
        waLabelId: label.waLabelId,
        name: label.name,
        color: label.color,
        predefined: label.predefined,
        deleted: label.deleted,
        conversationCount: label._count.chats,
        contactCount: contactAssociations.length,
        groupCount: groupAssociations.length,
        updatedAt: (lastAssociationUpdate ?? label.updatedAt).toISOString(),
        sendStats,
        lastCampaign: lastCampaign
          ? {
              id: lastCampaign.id,
              name: lastCampaign.name,
              status: lastCampaign.status,
              updatedAt: lastCampaign.updatedAt.toISOString()
            }
          : null
      };
    })
  });
}

