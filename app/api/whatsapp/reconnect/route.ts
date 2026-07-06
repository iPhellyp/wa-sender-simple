import { NextResponse } from "next/server";
import { getWhatsappStatus, markWhatsappConnecting } from "@/src/lib/baileys/client";
import { enqueueWhatsappConnect } from "@/src/lib/queue/campaign-queue";

export const runtime = "nodejs";

export async function POST() {
  await markWhatsappConnecting();
  await enqueueWhatsappConnect();
  return NextResponse.json(await getWhatsappStatus());
}
