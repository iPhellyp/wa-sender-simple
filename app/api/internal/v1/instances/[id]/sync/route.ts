import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { parseSyncBody, validateResourceId } from "@/src/lib/internal-api/schemas";
import { syncInternalInstance } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withInternalApi(
    async (innerRequest) => {
      const { id } = await context.params;
      const payload = parseSyncBody(await innerRequest.json().catch(() => null));
      return internalJson(
        await syncInternalInstance(validateResourceId(id, "instanceId"), payload.scope),
        202
      );
    },
    { idempotent: true }
  )(request);
}
