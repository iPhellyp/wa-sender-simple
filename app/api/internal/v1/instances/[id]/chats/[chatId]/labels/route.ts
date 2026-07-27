import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { listInternalChatLabels } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; chatId: string }> }
) {
  return withInternalApi(async () => {
    const { id, chatId } = await context.params;
    const instanceId = validateResourceId(id, "instanceId");
    const validChatId = validateResourceId(chatId, "chatId");
    return internalJson({
      instanceId,
      chatId: validChatId,
      labels: await listInternalChatLabels(instanceId, validChatId)
    });
  })(request);
}
