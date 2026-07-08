import { NextRequest, NextResponse } from "next/server";
import {
  WHATSAPP_INSTANCE_ROLE_LABELS,
  buildInstanceSessionKey,
  ensureDefaultWhatsappInstance,
  isWhatsappInstanceRole
} from "@/src/lib/server/whatsapp-instances";
import { prisma } from "@/src/lib/prisma/client";
import type { WhatsappInstanceRole } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDefaultWhatsappInstance();

  const instances = await prisma.whatsappInstance.findMany({
    orderBy: [
      {
        isDefault: "desc"
      },
      {
        createdAt: "asc"
      }
    ]
  });

  return NextResponse.json({
    instances: instances.map((instance) => ({
      ...instance,
      roleLabel: WHATSAPP_INSTANCE_ROLE_LABELS[instance.role]
    })),
    roles: WHATSAPP_INSTANCE_ROLE_LABELS
  });
}

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as {
    name?: string;
    role?: WhatsappInstanceRole;
    isDefault?: boolean;
  };
  const name = String(payload.name ?? "").trim();
  const role = String(payload.role ?? "GENERAL").trim();
  const isDefault = payload.isDefault === true;

  if (!name) {
    return NextResponse.json({ error: "Nome obrigatorio" }, { status: 400 });
  }

  if (!isWhatsappInstanceRole(role)) {
    return NextResponse.json({ error: "Funcao de instancia invalida" }, { status: 400 });
  }

  const instance = await prisma.$transaction(async (transaction) => {
    if (isDefault) {
      await transaction.whatsappInstance.updateMany({
        data: {
          isDefault: false
        }
      });
    }

    return transaction.whatsappInstance.create({
      data: {
        name,
        role: role as WhatsappInstanceRole,
        sessionKey: buildInstanceSessionKey(name),
        isDefault
      }
    });
  });

  return NextResponse.json(
    {
      instance,
      roleLabel: WHATSAPP_INSTANCE_ROLE_LABELS[instance.role]
    },
    { status: 201 }
  );
}




