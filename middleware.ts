import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  getRequestBaseUrl,
  isValidAdminSessionToken
} from "./src/lib/auth/session";

const protectedPagePrefixes = [
  "/dashboard",
  "/whatsapp",
  "/conversas",
  "/contatos",
  "/campanhas"
];

const protectedApiPrefixes = [
  "/api/import",
  "/api/contacts",
  "/api/whatsapp",
  "/api/campaigns"
];

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedPage = startsWithAny(pathname, protectedPagePrefixes);
  const isProtectedApi = startsWithAny(pathname, protectedApiPrefixes);

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const isValid = await isValidAdminSessionToken(token);

  if (isValid) {
    return NextResponse.next();
  }

  if (isProtectedApi) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", getRequestBaseUrl(request));
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
