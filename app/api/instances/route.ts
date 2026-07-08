import { NextRequest, NextResponse } from "next/server";
import type { WhatsappInstanceRole } from "@prisma/client";
import { getWhatsappInstanceRuntimeStatus } from "@/src/lib/baileys/instance-manager";
import { prisma } from "@/src/lib/prisma/client";
import {
  WHATSAPP_INSTANCE_ROLE_LABELS,
  buildInstanceSessionKey,
  isWhatsappInstanceRole
} from "@/src/lib/server/whatsapp-instances";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const instances = await prisma.whatsappInstance.findMany({
    orderBy: [
      {
        createdAt: "asc"
      }
    ]
  });
  const sessions = await prisma.whatsappSession.findMany({
    where: {
      instanceId: {
        in: instances.map((instance) => instance.id)
      }
    },
    select: {
      instanceId: true,
      lastError: true,
      updatedAt: true
    }
  });
  const lastErrorByInstanceId = new Map(
    sessions.map((session) => [session.instanceId, session.lastError])
  );
  const sessionUpdatedAtByInstanceId = new Map(
    sessions.map((session) => [session.instanceId, session.updatedAt])
  );
  const runtimeStatusByInstanceId = new Map(
    await Promise.all(
      instances.map(async (instance) => {
        const status = await getWhatsappInstanceRuntimeStatus(instance.id).catch(() => null);
        return [instance.id, status] as const;
      })
    )
  );

  return NextResponse.json({
    instances: instances.map((instance) => {
      const runtimeStatus = runtimeStatusByInstanceId.get(instance.id);
      return {
        ...instance,
        displayName: runtimeStatus?.displayName ?? null,
        profilePictureUrl: runtimeStatus?.profilePictureUrl ?? null,
        qrCode: runtimeStatus?.qrCode ?? null,
        hasQrCode: runtimeStatus?.hasQrCode ?? false,
        connectedPhone: runtimeStatus?.connectedPhone ?? instance.phone ?? null,
        hasSessionFiles: runtimeStatus?.hasSessionFiles ?? false,
        sessionFilesCount: runtimeStatus?.sessionFilesCount ?? 0,
        hasCredsJson: runtimeStatus?.hasCredsJson ?? false,
        hasRegisteredSession: runtimeStatus?.hasRegisteredSession ?? false,
        hasMe: runtimeStatus?.hasMe ?? false,
        hasMeId: runtimeStatus?.hasMeId ?? false,
        isPairingPartial: runtimeStatus?.isPairingPartial ?? false,
        isRecoverableSession: runtimeStatus?.isRecoverableSession ?? false,
        lastOpenAt: runtimeStatus?.lastOpenAt ?? null,
        updatedAt: sessionUpdatedAtByInstanceId.get(instance.id)?.toISOString() ?? instance.updatedAt.toISOString(),
        lastError: runtimeStatus?.lastError ?? lastErrorByInstanceId.get(instance.id) ?? null,
        roleLabel: WHATSAPP_INSTANCE_ROLE_LABELS[instance.role]
      };
    }),
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
  const existingCount = await prisma.whatsappInstance.count();
  const isDefault = existingCount === 0 || payload.isDefault === true;

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
