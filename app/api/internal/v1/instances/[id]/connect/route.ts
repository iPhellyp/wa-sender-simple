import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { parseConnectBody, validateResourceId } from "@/src/lib/internal-api/schemas";
import { connectInternalInstance } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withInternalApi(
    async (innerRequest) => {
      const { id } = await context.params;
      const payload = parseConnectBody(await innerRequest.json().catch(() => null));
      const result = await connectInternalInstance(
        validateResourceId(id, "instanceId"),
        payload.mode
      );
      return internalJson(result, result.enqueued ? 202 : 200);
    },
    { idempotent: true }
  )(request);
}
