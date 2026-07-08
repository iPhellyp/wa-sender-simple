import { CampaignRecipientStatus } from "@prisma/client";
import { prisma } from "../prisma/client";

export type ContactSendStatus = "sent" | "failed" | "pending" | "never_sent";

export type ContactLastSend = {
  status: ContactSendStatus;
  campaignId: string;
  campaignName: string;
  sentAt: Date | null;
  updatedAt: Date;
  error: string | null;
};

type RecipientWithCampaign = {
  contactId: string | null;
  jid: string | null;
  status: CampaignRecipientStatus;
  sentAt: Date | null;
  updatedAt: Date;
  error: string | null;
  campaign: {
    id: string;
    name: string;
  };
  contact?: {
    phoneNormalized: string;
  } | null;
};

function toSendStatus(status: CampaignRecipientStatus): ContactSendStatus {
  if (status === CampaignRecipientStatus.sent) return "sent";
  if (status === CampaignRecipientStatus.failed) return "failed";
  return "pending";
}

function toLastSend(recipient: RecipientWithCampaign): ContactLastSend {
  return {
    status: toSendStatus(recipient.status),
    campaignId: recipient.campaign.id,
    campaignName: recipient.campaign.name,
    sentAt: recipient.sentAt,
    updatedAt: recipient.updatedAt,
    error: recipient.error
  };
}

export async function getSendStatsByContact(contactIds: string[], instanceId?: string) {
  const uniqueIds = Array.from(new Set(contactIds.filter(Boolean)));
  const latestByContactId = new Map<string, ContactLastSend>();

  if (uniqueIds.length === 0) {
    return latestByContactId;
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      ...(instanceId ? { instanceId } : {}),
      contactId: {
        in: uniqueIds
      }
    },
    orderBy: {
      updatedAt: "desc"
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  for (const recipient of recipients) {
    if (!recipient.contactId || latestByContactId.has(recipient.contactId)) {
      continue;
    }

    latestByContactId.set(recipient.contactId, toLastSend(recipient));
  }

  return latestByContactId;
}

export async function getLastSendByPhone(phones: string[], instanceId?: string) {
  const uniquePhones = Array.from(new Set(phones.filter(Boolean)));
  const latestByPhone = new Map<string, ContactLastSend>();

  if (uniquePhones.length === 0) {
    return latestByPhone;
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      ...(instanceId ? { instanceId } : {}),
      contact: {
        ...(instanceId ? { instanceId } : {}),
        phoneNormalized: {
          in: uniquePhones
        }
      }
    },
    orderBy: {
      updatedAt: "desc"
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true
        }
      },
      contact: {
        select: {
          phoneNormalized: true
        }
      }
    }
  });

  for (const recipient of recipients) {
    const phone = recipient.contact?.phoneNormalized;

    if (!phone || latestByPhone.has(phone)) {
      continue;
    }

    latestByPhone.set(phone, toLastSend(recipient));
  }

  return latestByPhone;
}

export async function getLastSendByJid(jids: string[], instanceId?: string) {
  const uniqueJids = Array.from(new Set(jids.filter(Boolean)));
  const latestByJid = new Map<string, ContactLastSend>();

  if (uniqueJids.length === 0) {
    return latestByJid;
  }

  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      ...(instanceId ? { instanceId } : {}),
      jid: {
        in: uniqueJids
      }
    },
    orderBy: {
      updatedAt: "desc"
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  for (const recipient of recipients) {
    if (!recipient.jid || latestByJid.has(recipient.jid)) {
      continue;
    }

    latestByJid.set(recipient.jid, toLastSend(recipient));
  }

  return latestByJid;
}

export async function getSendStatsByPhone(phones: string[], instanceId?: string) {
  return getLastSendByPhone(phones, instanceId);
}

export async function getSendStatsByCampaign(campaignId: string, instanceId?: string) {
  const recipients = await prisma.campaignRecipient.findMany({
    where: {
      ...(instanceId ? { instanceId } : {}),
      campaignId
    },
    select: {
      status: true
    }
  });

  return recipients.reduce<Record<ContactSendStatus, number>>(
    (accumulator, recipient) => {
      accumulator[toSendStatus(recipient.status)] += 1;
      return accumulator;
    },
    {
      sent: 0,
      failed: 0,
      pending: 0,
      never_sent: 0
    }
  );
}
