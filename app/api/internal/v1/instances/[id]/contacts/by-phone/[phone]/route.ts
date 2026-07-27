import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validatePhone, validateResourceId } from "@/src/lib/internal-api/schemas";
import { findInternalContactByPhone } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; phone: string }> }
) {
  return withInternalApi(async () => {
    const { id, phone } = await context.params;
    return internalJson(
      await findInternalContactByPhone(
        validateResourceId(id, "instanceId"),
        validatePhone(phone)
      )
    );
  })(request);
}
