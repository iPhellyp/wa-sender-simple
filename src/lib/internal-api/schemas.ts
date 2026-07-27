import { InternalApiError } from "./errors";
import { normalizeBrazilPhone } from "../phone/normalize";
import {
  isWhatsappInstanceRole,
  type WhatsappInstanceRoleValue
} from "../server/whatsapp-instances";

function objectPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InternalApiError("VALIDATION_ERROR", "Corpo da requisição inválido", 400);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(payload: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(payload).some((key) => !allowed.includes(key))) {
    throw new InternalApiError("VALIDATION_ERROR", "Campo desconhecido", 400);
  }
}

export function validateResourceId(value: string, field = "id") {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(normalized)) {
    throw new InternalApiError("VALIDATION_ERROR", `${field} inválido`, 400);
  }
  return normalized;
}

export function parseCreateInstanceBody(value: unknown) {
  const payload = objectPayload(value);
  assertOnlyKeys(payload, ["name", "role"]);
  const name = String(payload.name ?? "").trim();
  const role = String(payload.role ?? "GENERAL").trim();

  if (!name || name.length > 120 || !isWhatsappInstanceRole(role)) {
    throw new InternalApiError("VALIDATION_ERROR", "Dados da instância inválidos", 400);
  }

  return { name, role: role as WhatsappInstanceRoleValue };
}

export function parseConnectBody(value: unknown) {
  const payload = objectPayload(value);
  assertOnlyKeys(payload, ["mode"]);
  const mode = String(payload.mode ?? "").trim();
  if (!["auto", "resume", "new_qr"].includes(mode)) {
    throw new InternalApiError("VALIDATION_ERROR", "Modo de conexão inválido", 400);
  }
  return { mode: mode as "auto" | "resume" | "new_qr" };
}

export function parseSyncBody(value: unknown) {
  const payload = objectPayload(value);
  assertOnlyKeys(payload, ["scope"]);
  const scope = String(payload.scope ?? "").trim();
  if (!["quick", "catalog", "history"].includes(scope)) {
    throw new InternalApiError("VALIDATION_ERROR", "Escopo de sincronização inválido", 400);
  }
  return { scope: scope as "quick" | "catalog" | "history" };
}

export function parseDisconnectBody(value: unknown) {
  const payload = objectPayload(value);
  assertOnlyKeys(payload, ["preserveSession"]);
  if (payload.preserveSession !== true) {
    throw new InternalApiError(
      "VALIDATION_ERROR",
      "preserveSession deve ser true",
      400
    );
  }
  return { preserveSession: true as const };
}

export function validatePhone(value: string) {
  const result = normalizeBrazilPhone(value);
  if (!result.ok) {
    throw new InternalApiError("VALIDATION_ERROR", "Telefone inválido", 400);
  }
  return result.normalized;
}
