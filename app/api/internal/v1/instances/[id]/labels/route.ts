import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { listInternalLabels } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withInternalApi(async () => {
    const { id } = await context.params;
    const instanceId = validateResourceId(id, "instanceId");
    return internalJson({ instanceId, labels: await listInternalLabels(instanceId) });
  })(request);
}
