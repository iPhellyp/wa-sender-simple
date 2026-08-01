import { NextRequest, NextResponse } from "next/server";
import { authenticateInternalRequest } from "./auth";
import { toInternalApiError } from "./errors";
import {
  abandonIdempotency,
  acquireIdempotency,
  buildIdempotencyFingerprint,
  completeIdempotency,
  validateIdempotencyKey,
  type IdempotencyRedis
} from "./idempotency";
import { enforceInternalRateLimit, type RateLimitRedis } from "./rate-limit";
import { getInternalApiRedis } from "./redis";
import { resolveRequestId } from "./request-id";
import { internalErrorResponse } from "./response";

export type InternalApiContext = {
  requestId: string;
  rateLimitDegraded: boolean;
};

type InternalHandler = (
  request: NextRequest,
  context: InternalApiContext
) => Promise<NextResponse>;

type InternalApiRedis = IdempotencyRedis & RateLimitRedis;

function shouldAbandonIdempotencyAfterError(
  phase: "pre-handler" | "handler-running" | "handler-complete",
  error: ReturnType<typeof toInternalApiError>
) {
  if (phase === "pre-handler") {
    return true;
  }

  return (
    phase === "handler-running" &&
    error.status >= 400 &&
    error.status < 500
  );
}

export function withInternalApi(
  handler: InternalHandler,
  options: { idempotent?: boolean; redis?: InternalApiRedis } = {}
) {
  return async (request: NextRequest) => {
    const requestId = resolveRequestId(request.headers.get("x-request-id"));
    let phase: "pre-handler" | "handler-running" | "handler-complete" = "pre-handler";
    let idempotencyState:
      | {
          key: string;
          ttl: number;
          fingerprint: string;
        }
      | undefined;

    try {
      const auth = authenticateInternalRequest(request.headers.get("authorization"));
      const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
      const redis = options.redis ?? getInternalApiRedis();
      const rateLimit = await enforceInternalRateLimit({
        redis,
        consumerHash: auth.consumerHash,
        route: request.nextUrl.pathname,
        mutation
      });

      if (options.idempotent) {
        const idempotencyKey = validateIdempotencyKey(request.headers.get("idempotency-key"));
        const body = await request.clone().text();
        const fingerprint = buildIdempotencyFingerprint(
          request.method,
          request.nextUrl.pathname,
          body
        );
        const acquired = await acquireIdempotency({
          redis,
          key: idempotencyKey,
          fingerprint
        });

        if (!acquired.acquired) {
          const response = new NextResponse(acquired.response.body ?? "", {
            status: acquired.response.status ?? 200,
            headers: {
              "Content-Type": acquired.response.contentType ?? "application/json",
              "X-Idempotent-Replay": "true",
              "X-Request-Id": requestId
            }
          });
          return response;
        }

        idempotencyState = {
          key: acquired.key,
          ttl: acquired.ttl,
          fingerprint
        };
      }

      phase = "handler-running";
      const response = await handler(request, {
          requestId,
          rateLimitDegraded: rateLimit.degraded
        });
      phase = "handler-complete";
      response.headers.set("X-Request-Id", requestId);

      if (idempotencyState) {
        try {
          const body = await response.clone().text();
          await completeIdempotency({
            redis,
            ...idempotencyState,
            status: response.status,
            body,
            contentType: response.headers.get("content-type") ?? "application/json"
          });
        } catch {
          response.headers.set("X-Idempotency-Status", "processing");
        }
      }

      return response;
    } catch (error) {
      const apiError = toInternalApiError(error);

      if (
        idempotencyState &&
        shouldAbandonIdempotencyAfterError(phase, apiError)
      ) {
        await abandonIdempotency(options.redis ?? getInternalApiRedis(), idempotencyState.key);
      }

      const response = internalErrorResponse(apiError, requestId);
      response.headers.set("X-Request-Id", requestId);
      return response;
    }
  };
}
