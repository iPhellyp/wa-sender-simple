import type { NextRequest } from "next/server";
import { withInternalApi } from "@/src/lib/internal-api/handler";
import { internalJson } from "@/src/lib/internal-api/response";
import { validateResourceId } from "@/src/lib/internal-api/schemas";
import {
  enqueueInternalChatMessage,
  listInternalChatMessages
} from "@/src/lib/internal-api/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; chatId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return withInternalApi(async () => {
    const { id, chatId } = await context.params;
    const instanceId = validateResourceId(id, "instanceId");
    const validChatId = validateResourceId(chatId, "chatId");
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    return internalJson(await listInternalChatMessages(instanceId, validChatId, {
      before: request.nextUrl.searchParams.get("before") ?? undefined,
      limit: Number.isInteger(rawLimit) ? rawLimit : 50
    }));
  })(request);
}

export async function POST(request: NextRequest, context: Context) {
  return withInternalApi(async () => {
    const { id, chatId } = await context.params;
    const instanceId = validateResourceId(id, "instanceId");
    const validChatId = validateResourceId(chatId, "chatId");
    const body = await request.json() as { text?: unknown };
    const text = typeof body.text === "string" ? body.text : "";
    return internalJson(
      await enqueueInternalChatMessage(instanceId, validChatId, text),
      202
    );
  }, { idempotent: true })(request);
}
