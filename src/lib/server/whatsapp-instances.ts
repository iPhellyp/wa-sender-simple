import { prisma } from "../prisma/client";
import { cookies } from "next/headers";
import { createHash } from "crypto";
import {
  Prisma,
  type WhatsappInstance,
  type WhatsappInstanceRole
} from "@prisma/client";

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

export function normalizeSemanticInstanceName(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function semanticInstanceNameKey(name: string) {
  return normalizeSemanticInstanceName(name).toLocaleLowerCase("pt-BR");
}

type SemanticInstanceLookup = {
  whatsappInstance: {
    findMany(options: {
      where: { role: WhatsappInstanceRole };
      orderBy: { createdAt: "asc" };
    }): Promise<WhatsappInstance[]>;
  };
};

async function findSemanticallyEquivalentInstance(
  client: SemanticInstanceLookup,
  name: string,
  role: WhatsappInstanceRole
) {
  const expectedName = semanticInstanceNameKey(name);
  const candidates = await client.whatsappInstance.findMany({
    where: { role },
    orderBy: { createdAt: "asc" }
  });
  return candidates.find((candidate) => semanticInstanceNameKey(candidate.name) === expectedName);
}

function advisoryLockId(value: string) {
  return createHash("sha256").update(value, "utf8").digest().readBigInt64BE(0);
}

export async function createWhatsappInstance(options: {
  name: string;
  role: WhatsappInstanceRole;
  reuseExisting?: boolean;
}) {
  if (!options.reuseExisting) {
    const existingCount = await prisma.whatsappInstance.count();
    const instance = await prisma.whatsappInstance.create({
      data: {
        name: options.name,
        role: options.role,
        sessionKey: buildInstanceSessionKey(options.name),
        isDefault: existingCount === 0
      }
    });
    return { instance, created: true };
  }

  const semanticName = normalizeSemanticInstanceName(options.name);
  const existing = await findSemanticallyEquivalentInstance(
    prisma,
    semanticName,
    options.role
  );
  if (existing) {
    return { instance: existing, created: false };
  }

  const semanticLockId = advisoryLockId(
    `wa2-instance-semantic:${options.role}:${semanticInstanceNameKey(semanticName)}`
  );
  const defaultLockId = advisoryLockId("wa2-instance-default-selection");

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(${semanticLockId})`
    );
    const concurrentExisting = await findSemanticallyEquivalentInstance(
      transaction,
      semanticName,
      options.role
    );
    if (concurrentExisting) {
      return { instance: concurrentExisting, created: false };
    }

    let existingCount = await transaction.whatsappInstance.count();
    if (existingCount === 0) {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${defaultLockId})`
      );
      existingCount = await transaction.whatsappInstance.count();
    }

    const instance = await transaction.whatsappInstance.create({
      data: {
        name: semanticName,
        role: options.role,
        sessionKey: buildInstanceSessionKey(semanticName),
        isDefault: existingCount === 0
      }
    });
    return { instance, created: true };
  });
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
