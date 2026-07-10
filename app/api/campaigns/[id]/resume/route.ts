import { NextRequest, NextResponse } from "next/server";
import { CampaignMediaError } from "@/src/lib/campaigns/media";
import { startCampaign } from "@/src/lib/campaigns/start-campaign";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instanceId = await getActiveInstanceIdFromSearchOrDefault(request.nextUrl.searchParams);
  let result: Awaited<ReturnType<typeof startCampaign>>;

  try {
    result = await startCampaign({
      campaignId: id,
      instanceId,
      origin: "MANUAL",
      allowPaused: true
    });
  } catch (error) {
    if (error instanceof CampaignMediaError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  if (result.reason === "another_campaign_running") {
    return NextResponse.json(
      {
        error:
          "Ja existe uma campanha ativa nesta instancia. Pause, cancele ou aguarde finalizar."
      },
      { status: 409 }
    );
  }

  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Campanha pausada nao encontrada" }, { status: 404 });
  }

  if (!result.started && !result.alreadyStarted) {
    return NextResponse.json(
      { error: "Campanha nao esta pausada" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
