-- CreateEnum
CREATE TYPE "WhatsappLabelEventOperation" AS ENUM ('APPLY', 'REMOVE');

-- CreateEnum
CREATE TYPE "WhatsappLabelEventSource" AS ENUM ('INTERNAL_API', 'WHATSAPP', 'UNKNOWN');

-- CreateTable
CREATE TABLE "WhatsappLabelEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventId" UUID NOT NULL,
    "instanceId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "phoneNormalized" TEXT,
    "waLabelId" TEXT NOT NULL,
    "operation" "WhatsappLabelEventOperation" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" "WhatsappLabelEventSource" NOT NULL,
    "correlationKey" TEXT,
    "eligibleForCrm" BOOLEAN NOT NULL DEFAULT false,
    "ineligibleReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappLabelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappLabelEvent_eventId_key" ON "WhatsappLabelEvent"("eventId");

-- CreateIndex
CREATE INDEX "WhatsappLabelEvent_instanceId_id_idx" ON "WhatsappLabelEvent"("instanceId", "id");

-- CreateIndex
CREATE INDEX "WhatsappLabelEvent_createdAt_id_idx" ON "WhatsappLabelEvent"("createdAt", "id");

-- AddForeignKey
ALTER TABLE "WhatsappLabelEvent" ADD CONSTRAINT "WhatsappLabelEvent_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
