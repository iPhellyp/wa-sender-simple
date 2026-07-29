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
    return internalJson(await rebuildInternalIdentities(validateResourceId(id, "instanceId")), 202);
  }, { idempotent: true })(request);
}
