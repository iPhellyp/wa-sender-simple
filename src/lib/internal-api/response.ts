import { NextResponse } from "next/server";
import type { InternalApiError } from "./errors";

export function internalJson(data: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}

export function internalErrorResponse(error: InternalApiError, requestId: string) {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId
      }
    },
    {
      status: error.status,
      headers: error.headers
    }
  );
}
