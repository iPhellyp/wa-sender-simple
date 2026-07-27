import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import { mutateInternalChatLabel } from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; chatId: string; waLabelId: string }>;
};

function mutate(operation: "apply" | "remove") {
  return async (request: NextRequest, context: RouteContext) =>
    withInternalApi(
      async (_request, internalContext) => {
        const { id, chatId, waLabelId } = await context.params;
        const result = await mutateInternalChatLabel({
          instanceId: validateResourceId(id, "instanceId"),
          chatId: validateResourceId(chatId, "chatId"),
          waLabelId: validateResourceId(waLabelId, "waLabelId"),
          operation,
          correlationKey: internalContext.requestId
        });
        return internalJson(
          {
            operation,
            ...result
          },
          result.enqueued ? 202 : 200
        );
      },
      { idempotent: true }
    )(request);
}

export const PUT = mutate("apply");
export const DELETE = mutate("remove");
