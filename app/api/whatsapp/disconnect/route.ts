import { NextResponse } from "next/server";
import { getWhatsappStatus, markWhatsappDisconnected } from "@/src/lib/baileys/client";
import { enqueueWhatsappDisconnect } from "@/src/lib/queue/campaign-queue";

export const runtime = "nodejs";

export async function POST() {
  await markWhatsappDisconnected();
  await enqueueWhatsappDisconnect();
  return NextResponse.json(await getWhatsappStatus());
}
