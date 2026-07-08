import { readdir, rm } from "fs/promises";
import { resolve } from "path";
import { WhatsappStatus, type WhatsappInstanceRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getBaileysSessionDirForInstance } from "@/src/lib/baileys/instance-manager";
import { prisma } from "@/src/lib/prisma/client";
import {
  WHATSAPP_INSTANCE_ROLE_LABELS,
  isWhatsappInstanceRole
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function removeInstanceSessionDir(instance: Parameters<typeof getBaileysSessionDirForInstance>[0]) {
  const sessionDir = resolve(getBaileysSessionDirForInstance(instance));

  if (instance.sessionKey !== "default") {
    await rm(sessionDir, { recursive: true, force: true });
    return;
  }

  const entries = await readdir(sessionDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      continue;
    }

    await rm(resolve(sessionDir, entry.name), { recursive: true, force: true });
  }
}

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

export async function DELETE(
  request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;
  const payload = (await request.json().catch(() => null)) as { confirmationName?: string } | null;
  const confirmationName = String(payload?.confirmationName ?? "");
  const instance = await prisma.whatsappInstance.findUnique({
    where: {
      id
    }
  });

  if (!instance) {
    return NextResponse.json({ error: "Instancia nao encontrada" }, { status: 404 });
  }

  if (confirmationName !== instance.name) {
    return NextResponse.json({ error: "Digite o nome da instancia para confirmar" }, { status: 400 });
  }

  if (
    instance.status === WhatsappStatus.connected ||
    instance.status === WhatsappStatus.connecting ||
    instance.status === WhatsappStatus.qr
  ) {
    return NextResponse.json(
      { error: "Desconecte a instancia antes de deletar." },
      { status: 409 }
    );
  }

  const replacementDefault = instance.isDefault
    ? await prisma.whatsappInstance.findFirst({
        where: {
          id: {
            not: instance.id
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      })
    : null;

  await prisma.$transaction(async (transaction) => {
    await transaction.sendLog.deleteMany({ where: { instanceId: instance.id } });
    await transaction.campaignRecipient.deleteMany({ where: { instanceId: instance.id } });
    await transaction.campaign.deleteMany({ where: { instanceId: instance.id } });
    await transaction.contact.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappChatLabel.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappMessage.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappLabel.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappContact.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappChat.deleteMany({ where: { instanceId: instance.id } });
    await transaction.whatsappSession.deleteMany({ where: { instanceId: instance.id } });

    if (replacementDefault) {
      await transaction.whatsappInstance.update({
        where: {
          id: replacementDefault.id
        },
        data: {
          isDefault: true
        }
      });
    }

    await transaction.whatsappInstance.delete({
      where: {
        id: instance.id
      }
    });
  });

  await removeInstanceSessionDir(instance);

  return NextResponse.json({
    ok: true,
    deletedInstanceId: instance.id,
    nextActiveInstanceId: replacementDefault?.id ?? null,
    message: "Instancia deletada com seguranca."
  });
}
