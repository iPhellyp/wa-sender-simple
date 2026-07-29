CREATE TABLE "WhatsappIdentity" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "lidJid" TEXT NOT NULL,
    "phoneJid" TEXT,
    "phoneNormalized" TEXT,
    "source" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappIdentity_instanceId_lidJid_key"
ON "WhatsappIdentity"("instanceId", "lidJid");
CREATE INDEX "WhatsappIdentity_instanceId_phoneNormalized_idx"
ON "WhatsappIdentity"("instanceId", "phoneNormalized");
CREATE INDEX "WhatsappIdentity_instanceId_confidence_idx"
ON "WhatsappIdentity"("instanceId", "confidence");
ALTER TABLE "WhatsappIdentity"
ADD CONSTRAINT "WhatsappIdentity_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "WhatsappInstance"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
