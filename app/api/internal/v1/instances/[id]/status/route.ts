import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { getInternalInstanceStatus } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Parameters<ReturnType<typeof withInternalApi>>[0],
  context: { params: Promise<{ id: string }> }
) {
  return withInternalApi(async () => {
    const { id } = await context.params;
    return internalJson(await getInternalInstanceStatus(validateResourceId(id, "instanceId")));
  })(request);
}
