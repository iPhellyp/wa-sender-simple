import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, getRequestBaseUrl } from "@/src/lib/auth/session";

export const runtime = "nodejs";

function logout(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", getRequestBaseUrl(request)), {
    status: 303
  });
  response.cookies.delete(ADMIN_SESSION_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  return logout(request);
}

export async function POST(request: NextRequest) {
  return logout(request);
}
