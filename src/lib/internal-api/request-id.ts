import { randomUUID } from "crypto";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidRequestId(value: string | null | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function resolveRequestId(value: string | null | undefined) {
  return isValidRequestId(value) ? String(value) : randomUUID();
}
