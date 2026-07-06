import { NextResponse } from "next/server";
import { getWhatsappStatus } from "@/src/lib/baileys/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getWhatsappStatus());
}
