import { CampaignStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";
import { schedulePendingRecipients } from "./schedule";

type StartCampaignOrigin = "MANUAL" | "SCHEDULER";

type StartCampaignOptions = {
  campaignId: string;
  instanceId: string;
  origin?: StartCampaignOrigin;
  allowPaused?: boolean;
};

export type StartCampaignResult = {
  started: boolean;
  alreadyStarted: boolean;
  campaignId: string;
  reason?: string;
};

const MAX_TRANSACTION_ATTEMPTS = 3;

function isTransactionConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function startCampaign({
  campaignId,
  instanceId,
  origin = "MANUAL",
  allowPaused = false
}: StartCampaignOptions): Promise<StartCampaignResult> {
  const normalizedCampaignId = campaignId.trim();
  const normalizedInstanceId = instanceId.trim();

  if (!normalizedCampaignId || !normalizedInstanceId) {
    return {
      started: false,
      alreadyStarted: false,
      campaignId: normalizedCampaignId,
      reason: "invalid_scope"
    };
  }

  let claimResult: StartCampaignResult | null = null;

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      claimResult = await prisma.$transaction(
        async (transaction) => {
          const campaign = await transaction.campaign.findFirst({
            where: {
              id: normalizedCampaignId,
              instanceId: normalizedInstanceId
            },
            select: {
              id: true,
              status: true,
              scheduledAt: true,
              startedAt: true
            }
          });

          if (!campaign) {
            return {
              started: false,
              alreadyStarted: false,
              campaignId: normalizedCampaignId,
              reason: "not_found"
            };
          }

          if (campaign.status === CampaignStatus.running) {
            return {
              started: false,
              alreadyStarted: true,
              campaignId: campaign.id,
              reason: "already_running"
            };
          }

          const allowedStatuses: CampaignStatus[] =
            origin === "SCHEDULER"
              ? [CampaignStatus.scheduled]
              : allowPaused
                ? [CampaignStatus.paused]
                : [CampaignStatus.draft, CampaignStatus.scheduled];

          if (!allowedStatuses.includes(campaign.status)) {
            return {
              started: false,
              alreadyStarted: false,
              campaignId: campaign.id,
              reason: "status_not_startable"
            };
          }

          if (
            origin === "SCHEDULER" &&
            (!campaign.scheduledAt || campaign.scheduledAt.getTime() > Date.now())
          ) {
            return {
              started: false,
              alreadyStarted: false,
              campaignId: campaign.id,
              reason: "not_due"
            };
          }

          const activeCampaign = await transaction.campaign.findFirst({
            where: {
              instanceId: normalizedInstanceId,
              id: {
                not: campaign.id
              },
              status: CampaignStatus.running
            },
            select: {
              id: true
            }
          });

          if (activeCampaign) {
            return {
              started: false,
              alreadyStarted: false,
              campaignId: campaign.id,
              reason: "another_campaign_running"
            };
          }

          const claimed = await transaction.campaign.updateMany({
            where: {
              id: campaign.id,
              instanceId: normalizedInstanceId,
              status: {
                in: allowedStatuses
              }
            },
            data: {
              status: CampaignStatus.running,
              scheduledAt: null,
              startedAt: campaign.startedAt ?? new Date()
            }
          });

          if (claimed.count === 0) {
            return {
              started: false,
              alreadyStarted: true,
              campaignId: campaign.id,
              reason: "already_claimed"
            };
          }

          return {
            started: true,
            alreadyStarted: false,
            campaignId: campaign.id
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
      break;
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS) {
        throw error;
      }
    }
  }

  if (!claimResult) {
    throw new Error("Nao foi possivel confirmar o inicio da campanha");
  }

  if (claimResult.started) {
    try {
      await schedulePendingRecipients(claimResult.campaignId);
    } catch (error) {
      console.error("[campaign] initial recipient scheduling failed", {
        campaignId: claimResult.campaignId,
        instanceId: normalizedInstanceId,
        origin
      });
      throw error;
    }
  }

  return claimResult;
}
