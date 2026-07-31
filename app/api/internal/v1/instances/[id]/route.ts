import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { deleteInternalInstance } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return withInternalApi(
    async () => {
      const { id } = await context.params;
      const result = await deleteInternalInstance(
        validateResourceId(id, "instanceId")
      );
      return internalJson(result, result.enqueued ? 202 : 200);
    },
    { idempotent: true }
  )(request);
}
