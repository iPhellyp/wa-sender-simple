import { prisma } from "../prisma/client";
import { cookies } from "next/headers";

export const WHATSAPP_INSTANCE_ROLES = [
  "SALES",
  "SUPPORT",
  "BILLING",
  "POST_SALES",
  "AFFILIATE",
  "GENERAL"
] as const;

export const DEFAULT_WHATSAPP_INSTANCE_ID = "default";
export const ACTIVE_INSTANCE_COOKIE_NAME = "wa_sender_active_instance_id";

export class WhatsappInstanceNotFoundError extends Error {
  constructor(readonly instanceId: string) {
    super("Instancia nao encontrada");
    this.name = "WhatsappInstanceNotFoundError";
  }
}

export class NoWhatsappInstanceError extends Error {
  constructor() {
    super("Nenhuma instancia cadastrada");
    this.name = "NoWhatsappInstanceError";
  }
}

export function isWhatsappInstanceNotFoundError(error: unknown): error is WhatsappInstanceNotFoundError {
  return error instanceof WhatsappInstanceNotFoundError || error instanceof NoWhatsappInstanceError;
}

export function isNoWhatsappInstanceError(error: unknown): error is NoWhatsappInstanceError {
  return error instanceof NoWhatsappInstanceError;
}

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
      name: "Numero inicial",
      role: "GENERAL",
      sessionKey: "default",
      isDefault: true
    }
  });
}

export async function getDefaultWhatsappInstance() {
  const defaultInstance = await prisma.whatsappInstance.findFirst({
    where: {
      isDefault: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (defaultInstance) {
    return defaultInstance;
  }

  const firstInstance = await prisma.whatsappInstance.findFirst({
    orderBy: {
      createdAt: "asc"
    }
  });

  if (firstInstance) {
    return firstInstance;
  }

  throw new NoWhatsappInstanceError();
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

    throw new WhatsappInstanceNotFoundError(normalizedInstanceId);
  }

  return getDefaultWhatsappInstance();
}

function pickSearchInstanceId(
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined> | null
) {
  if (searchParams instanceof URLSearchParams) {
    return searchParams.get("instanceId")?.trim() ?? "";
  }

  if (searchParams) {
    const value = searchParams.instanceId;
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  }

  return "";
}

export async function getActiveInstanceIdFromCookie() {
  const cookieStore = await cookies();
  return cookieStore.get(ACTIVE_INSTANCE_COOKIE_NAME)?.value.trim() ?? "";
}

export async function getActiveInstanceIdFromSearchOrDefault(
  searchParams?: URLSearchParams | Record<string, string | string[] | undefined> | null
) {
  const urlInstanceId = pickSearchInstanceId(searchParams);

  if (urlInstanceId) {
    const instance = await requireWhatsappInstance(urlInstanceId);
    return instance.id;
  }

  const cookieInstanceId = await getActiveInstanceIdFromCookie();

  if (cookieInstanceId) {
    const instance = await getWhatsappInstanceById(cookieInstanceId);

    if (instance) {
      return instance.id;
    }
  }

  const instance = await getDefaultWhatsappInstance();
  return instance.id;
}
