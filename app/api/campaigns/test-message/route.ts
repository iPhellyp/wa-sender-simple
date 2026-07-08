import { NextRequest, NextResponse } from "next/server";
import { renderCampaignMessage } from "@/src/lib/campaigns/message-template";
import { sendWhatsappPhoneMessageForInstance } from "@/src/lib/baileys/instance-manager";
import { normalizeBrazilPhone } from "@/src/lib/phone/normalize";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    instanceId?: string;
    phone?: string;
    message?: string;
    sampleName?: string;
  };
  const instanceId = await getActiveInstanceIdFromSearchOrDefault({
    instanceId: payload.instanceId
  });
  const normalizedPhone = normalizeBrazilPhone(String(payload.phone ?? ""));
  const message = String(payload.message ?? "").trim();

  if (!normalizedPhone.ok) {
    return NextResponse.json({ error: "Telefone de teste invalido" }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: "Mensagem de teste obrigatoria" }, { status: 400 });
  }

  const renderedMessage = renderCampaignMessage(message, {
    name: String(payload.sampleName ?? "Teste").trim() || "Teste",
    phoneNormalized: normalizedPhone.normalized,
    source: "teste"
  });

  if (!renderedMessage) {
    return NextResponse.json({ error: "Mensagem renderizada ficou vazia" }, { status: 400 });
  }

  await sendWhatsappPhoneMessageForInstance(instanceId, normalizedPhone.normalized, renderedMessage);

  return NextResponse.json({
    ok: true,
    message: "Mensagem de teste enviada."
  });
}
