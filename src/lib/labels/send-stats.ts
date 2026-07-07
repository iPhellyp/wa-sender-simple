import { CampaignRecipientStatus } from "@prisma/client";
import { prisma } from "../prisma/client";

export type CatalogSendStatus = "sent" | "failed" | "pending" | "never_sent";

export type LastSendSummary = {
  jid: string;
  status: CatalogSendStatus;
  sentAt: Date | null;
  updatedAt: Date;
  campaignId: string;
  campaignName: string;
  error: string | null;
};

export type SendJidSets = {
  sentJids: string[];
  failedJids: string[];
  anyRecipientJids: string[];
};

function toCatalogSendStatus(status: CampaignRecipientStatus): CatalogSendStatus {
  if (status === CampaignRecipientStatus.sent) {
    return "sent";
  }

  if (status === CampaignRecipientStatus.failed) {
    return "failed";
  }

  return "pending";
}

export async function getSendJidSets(): Promise<SendJidSets> {
  const [sentRows, failedRows, anyRows] = await Promise.all([
    prisma.campaignRecipient.findMany({
      distinct: ["jid"],
      where: {
        jid: {
          not: null
        },
        status: CampaignRecipientStatus.sent
      },
      select: {
        jid: true
      }
    }),
    prisma.campaignRecipient.findMany({
      distinct: ["jid"],
      where: {
        jid: {
          not: null
        },
        status: CampaignRecipientStatus.failed
      },
      select: {
        jid: true
      }
    }),
    prisma.campaignRecipient.findMany({
      distinct: ["jid"],
      where: {
        jid: {
          not: null
        }
      },
      select: {
        jid: true
      }
    })
  ]);

  return {
    sentJids: sentRows.flatMap((row) => (row.jid ? [row.jid] : [])),
    failedJids: failedRows.flatMap((row) => (row.jid ? [row.jid] : [])),
    anyRecipientJids: anyRows.flatMap((row) => (row.jid ? [row.jid] : []))
  };
}

export async function getLastSendByJids(jids: string[]) {
  if (jids.length === 0) {
    return new Map<string, LastSendSummary>();
  }

  const rows = await prisma.campaignRecipient.findMany({
    where: {
      jid: {
        in: jids
      }
    },
    orderBy: [
      {
        updatedAt: "desc"
      },
      {
        createdAt: "desc"
      }
    ],
    select: {
      jid: true,
      status: true,
      sentAt: true,
      updatedAt: true,
      error: true,
      campaign: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
  const byJid = new Map<string, LastSendSummary>();

  for (const row of rows) {
    if (!row.jid || byJid.has(row.jid)) {
      continue;
    }

    byJid.set(row.jid, {
      jid: row.jid,
      status: toCatalogSendStatus(row.status),
      sentAt: row.sentAt,
      updatedAt: row.updatedAt,
      campaignId: row.campaign.id,
      campaignName: row.campaign.name,
      error: row.error
    });
  }

  return byJid;
}
