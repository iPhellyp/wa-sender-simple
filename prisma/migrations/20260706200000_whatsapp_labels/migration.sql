-- CreateTable
CREATE TABLE "WhatsappLabel" (
    "id" TEXT NOT NULL,
    "waLabelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "predefined" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappChatLabel" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappChatLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendLog" (
    "id" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "chatId" TEXT,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "messageHash" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SendLog_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "targetMode" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "targetLabelId" TEXT,
ADD COLUMN     "excludeGroups" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "excludeAlreadySentDays" INTEGER,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "maxRecipients" INTEGER,
ADD COLUMN     "sendWindowStart" TEXT,
ADD COLUMN     "sendWindowEnd" TEXT;

-- AlterTable
ALTER TABLE "CampaignRecipient" ADD COLUMN     "chatId" TEXT,
ADD COLUMN     "jid" TEXT,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "skippedReason" TEXT,
ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ALTER COLUMN "contactId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappLabel_waLabelId_key" ON "WhatsappLabel"("waLabelId");

-- CreateIndex
CREATE INDEX "WhatsappLabel_deleted_idx" ON "WhatsappLabel"("deleted");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappChatLabel_chatId_labelId_key" ON "WhatsappChatLabel"("chatId", "labelId");

-- CreateIndex
CREATE INDEX "WhatsappChatLabel_jid_idx" ON "WhatsappChatLabel"("jid");

-- CreateIndex
CREATE INDEX "WhatsappChatLabel_labelId_idx" ON "WhatsappChatLabel"("labelId");

-- CreateIndex
CREATE INDEX "Campaign_targetMode_idx" ON "Campaign"("targetMode");

-- CreateIndex
CREATE INDEX "Campaign_targetLabelId_idx" ON "Campaign"("targetLabelId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_jid_key" ON "CampaignRecipient"("campaignId", "jid");

-- CreateIndex
CREATE INDEX "CampaignRecipient_jid_idx" ON "CampaignRecipient"("jid");

-- CreateIndex
CREATE INDEX "CampaignRecipient_dedupeKey_idx" ON "CampaignRecipient"("dedupeKey");

-- CreateIndex
CREATE INDEX "SendLog_jid_sentAt_idx" ON "SendLog"("jid", "sentAt");

-- CreateIndex
CREATE INDEX "SendLog_campaignId_idx" ON "SendLog"("campaignId");

-- CreateIndex
CREATE INDEX "SendLog_recipientId_idx" ON "SendLog"("recipientId");

-- CreateIndex
CREATE INDEX "SendLog_messageHash_idx" ON "SendLog"("messageHash");

-- AddForeignKey
ALTER TABLE "WhatsappChatLabel" ADD CONSTRAINT "WhatsappChatLabel_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WhatsappChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappChatLabel" ADD CONSTRAINT "WhatsappChatLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "WhatsappLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_targetLabelId_fkey" FOREIGN KEY ("targetLabelId") REFERENCES "WhatsappLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
