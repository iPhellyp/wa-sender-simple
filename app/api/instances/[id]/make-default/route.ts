import { NextResponse } from "next/server";
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
  const existing = await prisma.whatsappInstance.findUnique({
    where: {
      id
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
  }

  return NextResponse.json({
    instance: existing,
    message: "Instancia ativa deve ser controlada por URL, localStorage e cookie."
  });
}
