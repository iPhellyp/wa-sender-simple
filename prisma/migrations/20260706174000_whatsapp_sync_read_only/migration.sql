CREATE TABLE "WhatsappChat" (
  "id" TEXT NOT NULL,
  "jid" TEXT NOT NULL,
  "name" TEXT,
  "isGroup" BOOLEAN NOT NULL DEFAULT false,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMP(3),
  "lastMessageText" TEXT,
  "lastInboundAt" TIMESTAMP(3),
  "lastOutboundAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsappChat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappContact" (
  "id" TEXT NOT NULL,
  "jid" TEXT NOT NULL,
  "phone" TEXT,
  "name" TEXT,
  "pushName" TEXT,
  "isBusiness" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WhatsappContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappMessage" (
  "id" TEXT NOT NULL,
  "chatId" TEXT NOT NULL,
  "waMessageId" TEXT NOT NULL,
  "jid" TEXT NOT NULL,
  "fromMe" BOOLEAN NOT NULL DEFAULT false,
  "senderJid" TEXT,
  "timestamp" TIMESTAMP(3),
  "messageType" TEXT,
  "text" TEXT,
  "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappChat_jid_key" ON "WhatsappChat"("jid");
CREATE INDEX "WhatsappChat_lastMessageAt_idx" ON "WhatsappChat"("lastMessageAt");
CREATE INDEX "WhatsappChat_isGroup_idx" ON "WhatsappChat"("isGroup");

CREATE UNIQUE INDEX "WhatsappContact_jid_key" ON "WhatsappContact"("jid");
CREATE INDEX "WhatsappContact_phone_idx" ON "WhatsappContact"("phone");

CREATE UNIQUE INDEX "WhatsappMessage_jid_waMessageId_key" ON "WhatsappMessage"("jid", "waMessageId");
CREATE INDEX "WhatsappMessage_chatId_timestamp_idx" ON "WhatsappMessage"("chatId", "timestamp");
CREATE INDEX "WhatsappMessage_fromMe_idx" ON "WhatsappMessage"("fromMe");
CREATE INDEX "WhatsappMessage_jid_idx" ON "WhatsappMessage"("jid");

ALTER TABLE "WhatsappMessage"
  ADD CONSTRAINT "WhatsappMessage_chatId_fkey"
  FOREIGN KEY ("chatId") REFERENCES "WhatsappChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
