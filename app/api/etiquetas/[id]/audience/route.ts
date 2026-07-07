import { NextRequest, NextResponse } from "next/server";
import {
  ABSOLUTE_MAX_RECIPIENTS,
  buildLabelAudience,
  DEFAULT_EXCLUDE_ALREADY_SENT_DAYS,
  DEFAULT_MAX_RECIPIENTS
} from "@/src/lib/labels/audience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const includeGroups = false;
  const excludeOptOut = request.nextUrl.searchParams.get("excludeOptOut") !== "false";
  const excludeAlreadySentDays = Number(
    request.nextUrl.searchParams.get("excludeAlreadySentDays") ??
      DEFAULT_EXCLUDE_ALREADY_SENT_DAYS
  );
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
  const maxRecipients = Number(
    request.nextUrl.searchParams.get("maxRecipients") ?? DEFAULT_MAX_RECIPIENTS
  );
  const search = request.nextUrl.searchParams.get("search") ?? undefined;

  if (!Number.isFinite(excludeAlreadySentDays) || excludeAlreadySentDays < 0) {
    return NextResponse.json({ error: "excludeAlreadySentDays invalido" }, { status: 400 });
  }

  if (!Number.isFinite(maxRecipients) || maxRecipients < 1 || maxRecipients > ABSOLUTE_MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `maxRecipients deve estar entre 1 e ${ABSOLUTE_MAX_RECIPIENTS}` },
      { status: 400 }
    );
  }

  const audience = await buildLabelAudience({
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

  return NextResponse.json(audience);
}
