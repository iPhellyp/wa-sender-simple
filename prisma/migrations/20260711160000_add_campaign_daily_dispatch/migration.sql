ALTER TABLE "Campaign"
  ADD COLUMN "dispatchConfig" JSONB,
  ADD COLUMN "nextDispatchAt" TIMESTAMP(3);

CREATE INDEX "Campaign_instanceId_status_nextDispatchAt_idx"
  ON "Campaign"("instanceId", "status", "nextDispatchAt");
