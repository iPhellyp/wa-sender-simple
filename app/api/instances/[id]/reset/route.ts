import { NextResponse } from "next/server";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { enqueueWhatsappReset } from "@/src/lib/queue/campaign-queue";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const instance = await prisma.whatsappInstance.findUnique({
    where: {
      id
    }
  });

  if (!instance) {
    return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
  }

  await enqueueWhatsappReset(instance.id);

  return NextResponse.json({
    instance: await getWhatsappInstanceRuntimeStatus(instance.id),
    message: "Reset enfileirado para esta instancia."
  });
}
