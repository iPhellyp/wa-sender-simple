import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { rebuildInternalIdentities } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withInternalApi(async () => {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { phones?: unknown };
    const phones = Array.isArray(body.phones)
      ? [...new Set(body.phones.filter(
          (phone): phone is string => typeof phone === "string" && /^55[1-9]\d{9,10}$/.test(phone)
        ))].slice(0, 50_000)
      : [];
    return internalJson(
      await rebuildInternalIdentities(validateResourceId(id, "instanceId"), phones),
      202
    );
  }, { idempotent: true })(request);
}
