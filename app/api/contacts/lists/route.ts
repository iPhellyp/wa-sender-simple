import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/prisma/client";
import { getActiveInstanceIdFromSearchOrDefault } from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    instanceId?: string;
    listName?: string;
    confirmationName?: string;
  } | null;
  const listName = String(payload?.listName ?? "").trim();
  const confirmationName = String(payload?.confirmationName ?? "").trim();

  if (!listName) {
    return NextResponse.json({ error: "Nome da lista obrigatorio" }, { status: 400 });
  }

  if (confirmationName !== listName) {
    return NextResponse.json({ error: "Digite o nome da lista para confirmar" }, { status: 400 });
  }

  const instanceId = await getActiveInstanceIdFromSearchOrDefault({
    instanceId: payload?.instanceId
  });
  const result = await prisma.contact.updateMany({
    where: {
      instanceId,
      source: listName
    },
    data: {
      source: "lista removida"
    }
  });

  return NextResponse.json({
    ok: true,
    updated: result.count,
    message: "Lista removida dos contatos. Os contatos foram preservados."
  });
}
