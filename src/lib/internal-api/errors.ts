export const INTERNAL_API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "RATE_LIMITED",
  "INSTANCE_NOT_FOUND",
  "INSTANCE_STATE_CONFLICT",
  "QR_NOT_AVAILABLE",
  "CONTACT_NOT_FOUND",
  "CONTACT_AMBIGUOUS",
  "CHAT_NOT_FOUND",
  "LABEL_NOT_FOUND",
  "LID_UNRESOLVED",
  "UNSUPPORTED_JID",
  "IDEMPOTENCY_CONFLICT",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR"
] as const;

export type InternalApiErrorCode = (typeof INTERNAL_API_ERROR_CODES)[number];

export class InternalApiError extends Error {
  constructor(
    readonly code: InternalApiErrorCode,
    message: string,
    readonly status: number,
    readonly headers?: HeadersInit
  ) {
    super(message);
    this.name = "InternalApiError";
  }
}

export function toInternalApiError(error: unknown) {
  if (error instanceof InternalApiError) {
    return error;
  }

  return new InternalApiError("INTERNAL_ERROR", "Erro interno", 500);
}
