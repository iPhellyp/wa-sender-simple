import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { listLabelEvents } from "@/src/lib/labels/label-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withInternalApi(async (request) =>
  internalJson(await listLabelEvents(request.nextUrl.searchParams))
);
