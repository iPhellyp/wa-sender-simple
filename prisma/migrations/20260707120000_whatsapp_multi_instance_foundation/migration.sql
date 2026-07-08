-- CreateEnum
CREATE TYPE "WhatsappInstanceRole" AS ENUM ('SALES', 'SUPPORT', 'BILLING', 'POST_SALES', 'AFFILIATE', 'GENERAL');

-- CreateTable
CREATE TABLE "WhatsappInstance" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "role" "WhatsappInstanceRole" NOT NULL DEFAULT 'GENERAL',
  "status" "WhatsappStatus" NOT NULL DEFAULT 'disconnected',
  "sessionKey" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "lastConnectedAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WhatsappInstance_pkey" PRIMARY KEY ("id")
);

-- Seed default instance before backfill.
INSERT INTO "WhatsappInstance" (
  "id",
  "name",
  "phone",
  "role",
  "status",
  "sessionKey",
  "isDefault",
  "lastConnectedAt",
  "lastSyncAt"
)
SELECT
  'default',
  'Principal',
  MAX("connectedPhone"),
  'GENERAL'::"WhatsappInstanceRole",
  COALESCE(MAX("status"::text), 'disconnected')::"WhatsappStatus",
  'default',
  true,
  MAX(CASE WHEN "status" = 'connected' THEN "updatedAt" ELSE NULL END),
  NULL
FROM "WhatsappSession"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "WhatsappInstance" ("id", "name", "role", "sessionKey", "isDefault")
SELECT 'default', 'Principal', 'GENERAL'::"WhatsappInstanceRole", 'default', true
WHERE NOT EXISTS (SELECT 1 FROM "WhatsappInstance" WHERE "id" = 'default');

-- Add nullable instanceId columns for safe backfill.
ALTER TABLE "Contact" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "WhatsappSession" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "WhatsappChat" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "WhatsappContact" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "WhatsappLabel" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "WhatsappChatLabel" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "CampaignRecipient" ADD COLUMN "instanceId" TEXT;
ALTER TABLE "SendLog" ADD COLUMN "instanceId" TEXT;

-- Backfill existing operational data to the default instance.
UPDATE "Contact" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "WhatsappSession" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "WhatsappChat" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "WhatsappContact" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "WhatsappMessage" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "WhatsappLabel" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "WhatsappChatLabel" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "Campaign" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "CampaignRecipient" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;
UPDATE "SendLog" SET "instanceId" = 'default' WHERE "instanceId" IS NULL;

-- Make instanceId required after backfill.
ALTER TABLE "Contact" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "WhatsappSession" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "WhatsappChat" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "WhatsappContact" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "WhatsappMessage" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "WhatsappLabel" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "WhatsappChatLabel" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "Campaign" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "CampaignRecipient" ALTER COLUMN "instanceId" SET NOT NULL;
ALTER TABLE "SendLog" ALTER COLUMN "instanceId" SET NOT NULL;

-- Drop global uniques that would block the same WhatsApp data in different instances.
DROP INDEX IF EXISTS "Contact_phoneNormalized_key";
DROP INDEX IF EXISTS "WhatsappChat_jid_key";
DROP INDEX IF EXISTS "WhatsappContact_jid_key";
DROP INDEX IF EXISTS "WhatsappLabel_waLabelId_key";
DROP INDEX IF EXISTS "WhatsappMessage_jid_waMessageId_key";
DROP INDEX IF EXISTS "WhatsappChatLabel_chatId_labelId_key";

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappInstance_sessionKey_key" ON "WhatsappInstance"("sessionKey");
CREATE UNIQUE INDEX "WhatsappInstance_single_default_key" ON "WhatsappInstance"("isDefault") WHERE "isDefault" = true;
CREATE INDEX "WhatsappInstance_isDefault_idx" ON "WhatsappInstance"("isDefault");
CREATE INDEX "WhatsappInstance_role_idx" ON "WhatsappInstance"("role");
CREATE UNIQUE INDEX "Contact_instanceId_phoneNormalized_key" ON "Contact"("instanceId", "phoneNormalized");
CREATE INDEX "Contact_instanceId_idx" ON "Contact"("instanceId");
CREATE INDEX "WhatsappSession_instanceId_idx" ON "WhatsappSession"("instanceId");
CREATE UNIQUE INDEX "WhatsappChat_instanceId_jid_key" ON "WhatsappChat"("instanceId", "jid");
CREATE INDEX "WhatsappChat_instanceId_jid_idx" ON "WhatsappChat"("instanceId", "jid");
CREATE UNIQUE INDEX "WhatsappContact_instanceId_jid_key" ON "WhatsappContact"("instanceId", "jid");
CREATE INDEX "WhatsappContact_instanceId_phone_idx" ON "WhatsappContact"("instanceId", "phone");
CREATE UNIQUE INDEX "WhatsappMessage_instanceId_jid_waMessageId_key" ON "WhatsappMessage"("instanceId", "jid", "waMessageId");
CREATE INDEX "WhatsappMessage_instanceId_jid_idx" ON "WhatsappMessage"("instanceId", "jid");
CREATE UNIQUE INDEX "WhatsappLabel_instanceId_waLabelId_key" ON "WhatsappLabel"("instanceId", "waLabelId");
CREATE INDEX "WhatsappLabel_instanceId_waLabelId_idx" ON "WhatsappLabel"("instanceId", "waLabelId");
CREATE UNIQUE INDEX "WhatsappChatLabel_instanceId_chatId_labelId_key" ON "WhatsappChatLabel"("instanceId", "chatId", "labelId");
CREATE INDEX "WhatsappChatLabel_instanceId_jid_idx" ON "WhatsappChatLabel"("instanceId", "jid");
CREATE INDEX "Campaign_instanceId_createdAt_idx" ON "Campaign"("instanceId", "createdAt");
CREATE INDEX "CampaignRecipient_instanceId_campaignId_idx" ON "CampaignRecipient"("instanceId", "campaignId");
CREATE INDEX "SendLog_instanceId_jid_sentAt_idx" ON "SendLog"("instanceId", "jid", "sentAt");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsappSession" ADD CONSTRAINT "WhatsappSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappChat" ADD CONSTRAINT "WhatsappChat_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappContact" ADD CONSTRAINT "WhatsappContact_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappLabel" ADD CONSTRAINT "WhatsappLabel_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappChatLabel" ADD CONSTRAINT "WhatsappChatLabel_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
