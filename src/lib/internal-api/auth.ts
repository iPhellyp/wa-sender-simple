import { createHash, timingSafeEqual } from "crypto";
import { InternalApiError } from "./errors";

function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function compareSecretHashes(candidate: string, expected: string) {
  return timingSafeEqual(hashSecret(candidate), hashSecret(expected));
}

export type InternalApiAuth = {
  consumerHash: string;
};

export function authenticateInternalRequest(
  authorization: string | null,
  configuration: {
    current?: string;
    previous?: string;
  } = {
    current: process.env.WA2_INTERNAL_API_SECRET,
    previous: process.env.WA2_INTERNAL_API_PREVIOUS_SECRET
  }
): InternalApiAuth {
  const current = configuration.current?.trim();
  const previous = configuration.previous?.trim();

  if (!current) {
    throw new InternalApiError(
      "DEPENDENCY_UNAVAILABLE",
      "API interna indisponível",
      503
    );
  }

  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const candidate = match?.[1] ?? "";
  const matchesCurrent = compareSecretHashes(candidate, current);
  const matchesPrevious = previous ? compareSecretHashes(candidate, previous) : false;

  if (!candidate || (!matchesCurrent && !matchesPrevious)) {
    throw new InternalApiError("UNAUTHORIZED", "Não autorizado", 401);
  }

  return {
    consumerHash: createHash("sha256")
      .update(matchesCurrent ? `current:${current}` : `previous:${previous}`, "utf8")
      .digest("hex")
  };
}
