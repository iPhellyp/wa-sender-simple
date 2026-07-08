import { NextResponse } from "next/server";
import { WhatsappStatus } from "@prisma/client";
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

  await prisma.whatsappSession.updateMany({
    where: {
      instanceId: instance.id
    },
    data: {
      status: WhatsappStatus.disconnected,
      qrCode: null,
      connectedPhone: null,
      lastError: null
    }
  });
  await prisma.whatsappInstance.update({
    where: {
      id: instance.id
    },
    data: {
      status: WhatsappStatus.disconnected,
      phone: null
    }
  });
  const jobId = await enqueueWhatsappReset(instance.id);
  console.log("[instances-api] reset enqueued", {
    action: "reset_session",
    instanceId: instance.id,
    sessionKey: instance.sessionKey,
    jobId
  });

  return NextResponse.json({
    instance: await getWhatsappInstanceRuntimeStatus(instance.id),
    message: "Reset enfileirado para esta instancia."
  });
}
