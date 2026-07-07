import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  getRequestBaseUrl,
  isAdminPasswordConfigured,
  isPasswordValid
} from "@/src/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const baseUrl = getRequestBaseUrl(request);
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");

  if (!isAdminPasswordConfigured()) {
    const loginUrl = new URL("/login", baseUrl);
    loginUrl.searchParams.set("error", "server_config");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  if (!isPasswordValid(password)) {
    const loginUrl = new URL("/login", baseUrl);
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const response = NextResponse.redirect(new URL("/dashboard", baseUrl), {
    status: 303
  });

  response.cookies.set(ADMIN_SESSION_COOKIE, await createAdminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12
  });

  return response;
}

