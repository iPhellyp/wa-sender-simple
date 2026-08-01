import { Prisma } from "@prisma/client";
import { prisma } from "../prisma/client";

const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_ATTEMPTS = 12;

function config() {
  const url = String(process.env.CRM_INTERNAL_LABEL_EVENT_URL ?? "").trim();
  const secret = String(process.env.CRM_INTERNAL_API_SECRET ?? "").trim();
  const timeout = Number(process.env.CRM_INTERNAL_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return { url, secret, timeout: Number.isFinite(timeout) ? Math.min(Math.max(timeout, 250), 10_000) : DEFAULT_TIMEOUT_MS };
}

export async function enqueueCrmLabelEventDelivery(transaction: { $executeRaw(query: Prisma.Sql): Promise<number> }, payload: Record<string, unknown>) {
  const eventId = String(payload.eventId ?? "").trim();
  if (!eventId) return;
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "CrmLabelEventDelivery" ("eventId", "payload")
    VALUES (${eventId}::uuid, ${JSON.stringify(payload)}::jsonb)
    ON CONFLICT ("eventId") DO NOTHING
  `);
}

function retryAt(attempts: number) {
  return new Date(Date.now() + Math.min(60 * 60_000, 1_000 * 2 ** Math.min(attempts, 10)));
}

export async function deliverPendingCrmLabelEvents(limit = 10) {
  const { url, secret, timeout } = config();
  if (!url || !secret) return { skipped: true, delivered: 0 };
  const rows = await prisma.$queryRaw<Array<{ id: bigint; attempts: number; payload: unknown }>>(Prisma.sql`
    UPDATE "CrmLabelEventDelivery"
    SET "status" = 'RETRY', "attempts" = "attempts" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" IN (
      SELECT "id" FROM "CrmLabelEventDelivery"
      WHERE "status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= CURRENT_TIMESTAMP
      ORDER BY "id" FOR UPDATE SKIP LOCKED LIMIT ${limit}
    )
    RETURNING "id", "attempts", "payload"
  `);
  let delivered = 0;
  for (const row of rows) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify(row.payload),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`CRM_PUSH_HTTP_${response.status}`);
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "CrmLabelEventDelivery" SET "status" = 'SENT', "sentAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${row.id}
      `);
      delivered += 1;
    } catch (error) {
      const attempts = Number(row.attempts ?? 1);
      const terminal = attempts >= MAX_ATTEMPTS;
      const message = error instanceof Error && error.name === "AbortError" ? "CRM_PUSH_TIMEOUT" : "CRM_PUSH_FAILED";
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "CrmLabelEventDelivery"
        SET "status" = ${terminal ? "FAILED" : "RETRY"}::"CrmLabelEventDeliveryStatus",
            "nextAttemptAt" = ${retryAt(attempts)}, "lastError" = ${message}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${row.id}
      `);
    } finally {
      clearTimeout(timer);
    }
  }
  return { skipped: false, delivered };
}
