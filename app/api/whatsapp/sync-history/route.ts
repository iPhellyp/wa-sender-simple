import { NextResponse } from "next/server";
import { requestWhatsappHistorySync } from "@/src/lib/baileys/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await requestWhatsappHistorySync();

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Erro ao verificar historico" },
      { status: 500 }
    );
  }
}
