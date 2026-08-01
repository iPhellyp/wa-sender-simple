CREATE TYPE "CrmLabelEventDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'RETRY', 'FAILED');

CREATE TABLE "CrmLabelEventDelivery" (
    "id" BIGSERIAL NOT NULL,
    "eventId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "CrmLabelEventDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmLabelEventDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrmLabelEventDelivery_eventId_key" ON "CrmLabelEventDelivery"("eventId");
CREATE INDEX "CrmLabelEventDelivery_claim_idx" ON "CrmLabelEventDelivery"("status", "nextAttemptAt", "id");
