import { NextRequest, NextResponse } from "next/server";
import {
  WHATSAPP_INSTANCE_ROLE_LABELS,
  isWhatsappInstanceRole
} from "@/src/lib/server/whatsapp-instances";
import { prisma } from "@/src/lib/prisma/client";
import type { WhatsappInstanceRole } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const payload = (await request.json()) as {
    name?: string;
    role?: WhatsappInstanceRole;
    isDefault?: boolean;
  };
  const data: {
    name?: string;
    role?: WhatsappInstanceRole;
  } = {};

  if (payload.name !== undefined) {
    const name = String(payload.name ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Nome obrigatorio" }, { status: 400 });
    }

    data.name = name;
  }

  if (payload.role !== undefined) {
    const role = String(payload.role ?? "").trim();

    if (!isWhatsappInstanceRole(role)) {
      return NextResponse.json({ error: "Funcao de instancia invalida" }, { status: 400 });
    }

    data.role = role as WhatsappInstanceRole;
  }

  const existing = await prisma.whatsappInstance.findUnique({
    where: {
      id
    }
  });

  if (!existing) {
    return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
  }

  const instance = await prisma.$transaction(async (transaction) => {
    if (payload.isDefault === true) {
      await transaction.whatsappInstance.updateMany({
        data: {
          isDefault: false
        }
      });
    }

    return transaction.whatsappInstance.update({
      where: {
        id
      },
      data: {
        ...data,
        ...(payload.isDefault === true ? { isDefault: true } : {})
      }
    });
  });

  return NextResponse.json({
    instance,
    roleLabel: WHATSAPP_INSTANCE_ROLE_LABELS[instance.role]
  });
}




