ALTER TYPE "CampaignStatus" ADD VALUE 'scheduled';

ALTER TABLE "Campaign"
  ADD COLUMN "scheduledAt" TIMESTAMP(3),
  ADD COLUMN "mediaKind" TEXT,
  ADD COLUMN "mediaPath" TEXT,
  ADD COLUMN "mediaOriginalName" TEXT,
  ADD COLUMN "mediaMimeType" TEXT,
  ADD COLUMN "mediaSizeBytes" INTEGER;

CREATE INDEX "Campaign_instanceId_status_scheduledAt_idx"
  ON "Campaign"("instanceId", "status", "scheduledAt");
