import { NextRequest, NextResponse } from "next/server";
import {
  buildLabelAudience,
  DEFAULT_EXCLUDE_ALREADY_SENT_DAYS
} from "@/src/lib/labels/audience";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  const includeGroups = false;
  const excludeOptOut = request.nextUrl.searchParams.get("excludeOptOut") !== "false";
  const excludeAlreadySentDays = Number(
    request.nextUrl.searchParams.get("excludeAlreadySentDays") ??
      DEFAULT_EXCLUDE_ALREADY_SENT_DAYS
  );
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const maxRecipientsParam = request.nextUrl.searchParams.get("maxRecipients");
  const maxRecipients = maxRecipientsParam ? Number(maxRecipientsParam) : null;
  const search = request.nextUrl.searchParams.get("search") ?? undefined;

  if (!Number.isFinite(excludeAlreadySentDays) || excludeAlreadySentDays < 0) {
    return NextResponse.json({ error: "excludeAlreadySentDays invalido" }, { status: 400 });
  }

  if (maxRecipients !== null && (!Number.isInteger(maxRecipients) || maxRecipients < 1)) {
    return NextResponse.json({ error: "maxRecipients deve ser inteiro e maior que zero" }, { status: 400 });
  }

  const audience = await buildLabelAudience({
    instanceId,
    labelId: id,
    includeGroups,
    excludeOptOut,
    excludeAlreadySentDays,
    limit,
    maxRecipients,
    search
  });

  if (!audience) {
    return NextResponse.json({ error: "Etiqueta nao encontrada" }, { status: 404 });
  }

  const { eligibleRecipients: _eligibleRecipients, ...safeAudience } = audience;
  return NextResponse.json(safeAudience);
}

