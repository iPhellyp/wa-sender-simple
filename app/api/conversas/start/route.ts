import { NextRequest, NextResponse } from "next/server";
import { ensureChatForJid } from "@/src/lib/baileys/sync";
import { normalizeBrazilPhone, toWhatsappJid } from "@/src/lib/phone/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    phone?: string;
    name?: string | null;
  };

  const phone = String(payload.phone ?? "").trim();
  const name = String(payload.name ?? "").trim();
  const normalizedPhone = normalizeBrazilPhone(phone);

  if (!normalizedPhone.ok) {
    return NextResponse.json({ error: normalizedPhone.reason }, { status: 400 });
  }

  try {
    const chat = await ensureChatForJid(toWhatsappJid(normalizedPhone.normalized), name || null);

    return NextResponse.json({
      chatId: chat.id,
      redirectUrl: `/conversas/${chat.id}`
    });
  } catch {
    return NextResponse.json(
      { error: "Erro ao criar conversa" },
      { status: 500 }
    );
  }
}

