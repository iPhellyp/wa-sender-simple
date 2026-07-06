import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
  isAdminPasswordConfigured,
  isPasswordValid
} from "@/src/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const requestedNextPath = String(formData.get("next") ?? "/dashboard");
  const nextPath =
    requestedNextPath.startsWith("/") && !requestedNextPath.startsWith("//")
      ? requestedNextPath
      : "/dashboard";

  if (!isAdminPasswordConfigured() || !isPasswordValid(password)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const response = NextResponse.redirect(new URL(nextPath || "/dashboard", request.url), {
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
