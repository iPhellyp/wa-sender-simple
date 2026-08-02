import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { listInternalChats } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withInternalApi(async () => {
    const { id } = await context.params;
    const instanceId = validateResourceId(id, "instanceId");
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    return internalJson(await listInternalChats(instanceId, {
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      cursor: request.nextUrl.searchParams.get("cursor") ?? undefined,
      limit: Number.isInteger(rawLimit) ? rawLimit : 50
    }));
  })(request);
}
