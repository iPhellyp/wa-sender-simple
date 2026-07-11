ALTER TABLE "Campaign"
  ADD COLUMN "dedupeMode" TEXT NOT NULL DEFAULT 'same_campaign',
  ADD COLUMN "creationKey" TEXT;

UPDATE "Campaign"
SET "dedupeMode" = 'recent_days'
WHERE "excludeAlreadySentDays" IS NOT NULL
  AND "excludeAlreadySentDays" > 0;

CREATE UNIQUE INDEX "Campaign_instanceId_creationKey_key"
  ON "Campaign"("instanceId", "creationKey");
