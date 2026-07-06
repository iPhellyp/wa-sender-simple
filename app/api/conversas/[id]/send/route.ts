import { NextRequest, NextResponse } from "next/server";
import { enqueueManualMessage } from "@/src/lib/queue/campaign-queue";
import { prisma } from "@/src/lib/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const payload = (await request.json()) as {
    text?: string;
  };
  const text = String(payload.text ?? "").trim();

  if (!text) {
    return NextResponse.json({ error: "Mensagem obrigatoria" }, { status: 400 });
  }

  if (text.length > 4000) {
    return NextResponse.json(
      { error: "Mensagem deve ter no maximo 4000 caracteres" },
      { status: 400 }
    );
  }

  const chat = await prisma.whatsappChat.findUnique({
    where: {
      id
    }
  });

  if (!chat) {
    return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });
  }

  let jobId: string | null = null;

  try {
    jobId = await enqueueManualMessage({
      chatId: chat.id,
      jid: chat.jid,
      text
    });
  } catch {
    return NextResponse.json(
      { error: "Erro ao enfileirar mensagem manual" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    jobId,
    message: "Mensagem enviada para fila"
  });
}
