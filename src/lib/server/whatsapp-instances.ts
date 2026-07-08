import { prisma } from "../prisma/client";

export const WHATSAPP_INSTANCE_ROLES = [
  "SALES",
  "SUPPORT",
  "BILLING",
  "POST_SALES",
  "AFFILIATE",
  "GENERAL"
] as const;

export const DEFAULT_WHATSAPP_INSTANCE_ID = "default";

export type WhatsappInstanceRoleValue = (typeof WHATSAPP_INSTANCE_ROLES)[number];

export const WHATSAPP_INSTANCE_ROLE_LABELS: Record<WhatsappInstanceRoleValue, string> = {
  SALES: "Vendas",
  SUPPORT: "Suporte",
  BILLING: "Cobranca",
  POST_SALES: "Pos-venda",
  AFFILIATE: "Afiliados/Achadinhos",
  GENERAL: "Geral"
};

export function isWhatsappInstanceRole(value: string): value is WhatsappInstanceRoleValue {
  return WHATSAPP_INSTANCE_ROLES.includes(value as WhatsappInstanceRoleValue);
}

function slugSessionKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildInstanceSessionKey(name: string) {
  const base = slugSessionKey(name) || "instance";
  return `${base}-${Date.now()}`;
}

export async function ensureDefaultWhatsappInstance() {
  const existingDefault = await prisma.whatsappInstance.findFirst({
    where: {
      isDefault: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (existingDefault) {
    return existingDefault;
  }

  const existingByKey = await prisma.whatsappInstance.findUnique({
    where: {
      sessionKey: "default"
    }
  });

  if (existingByKey) {
    return prisma.whatsappInstance.update({
      where: {
        id: existingByKey.id
      },
      data: {
        isDefault: true
      }
    });
  }

  return prisma.whatsappInstance.create({
    data: {
      id: "default",
      name: "Principal",
      role: "GENERAL",
      sessionKey: "default",
      isDefault: true
    }
  });
}

export async function getDefaultWhatsappInstance() {
  return ensureDefaultWhatsappInstance();
}

export async function getWhatsappInstanceById(instanceId: string) {
  return prisma.whatsappInstance.findUnique({
    where: {
      id: instanceId
    }
  });
}

export async function requireWhatsappInstance(instanceId?: string | null) {
  const normalizedInstanceId = instanceId?.trim();

  if (normalizedInstanceId) {
    const instance = await getWhatsappInstanceById(normalizedInstanceId);

    if (instance) {
      return instance;
    }
  }

  return getDefaultWhatsappInstance();
}

export async function getActiveInstanceIdFromSearchOrDefault(
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined> | null
) {
  let instanceId: string | null = null;

  if (searchParams instanceof URLSearchParams) {
    instanceId = searchParams.get("instanceId");
  } else if (searchParams) {
    const value = searchParams.instanceId;
    instanceId = Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  const instance = await requireWhatsappInstance(instanceId);
  return instance.id;
}
