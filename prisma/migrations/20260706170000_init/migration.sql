CREATE TYPE "WhatsappStatus" AS ENUM ('disconnected', 'connecting', 'qr', 'connected', 'error');

CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'running', 'paused', 'completed', 'canceled');

CREATE TYPE "CampaignRecipientStatus" AS ENUM ('pending', 'scheduled', 'sending', 'sent', 'failed', 'canceled');

CREATE TABLE "Contact" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phoneRaw" TEXT NOT NULL,
  "phoneNormalized" TEXT NOT NULL,
  "message" TEXT,
  "source" TEXT NOT NULL,
  "optedOut" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportBatch" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL,
  "insertedRows" INTEGER NOT NULL,
  "duplicatedRows" INTEGER NOT NULL,
  "invalidRows" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappSession" (
  "id" TEXT NOT NULL,
  "status" "WhatsappStatus" NOT NULL DEFAULT 'disconnected',
  "qrCode" TEXT,
  "connectedPhone" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsappSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "defaultMessage" TEXT,
  "intervalMinutes" INTEGER NOT NULL,
  "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "messageFinal" TEXT NOT NULL,
  "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'pending',
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Contact_phoneNormalized_key" ON "Contact"("phoneNormalized");
CREATE INDEX "Contact_source_idx" ON "Contact"("source");
CREATE INDEX "Contact_optedOut_idx" ON "Contact"("optedOut");
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
CREATE INDEX "CampaignRecipient_contactId_idx" ON "CampaignRecipient"("contactId");

ALTER TABLE "CampaignRecipient"
  ADD CONSTRAINT "CampaignRecipient_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CampaignRecipient"
  ADD CONSTRAINT "CampaignRecipient_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
