export const ADMIN_SESSION_COOKIE = "wa_sender_admin_session";

const SESSION_MESSAGE = "wa-sender-simple-admin-session";

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function getRequestBaseUrl(request: {
  headers: Headers;
  nextUrl: {
    origin: string;
  };
}) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? "https";

  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return request.nextUrl.origin;
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD ?? "";
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

export async function createAdminSessionToken() {
  const password = getAdminPassword();

  if (!password) {
    throw new Error("ADMIN_PASSWORD is not configured");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(SESSION_MESSAGE)
  );

  return toHex(signature);
}

export async function isValidAdminSessionToken(token: string | undefined | null) {
  const password = getAdminPassword();

  if (!password || !token) {
    return false;
  }

  const expectedToken = await createAdminSessionToken();
  return constantTimeEqual(token, expectedToken);
}

export function isAdminPasswordConfigured() {
  return Boolean(getAdminPassword());
}

export function isPasswordValid(password: string) {
  const expectedPassword = getAdminPassword();

  if (!expectedPassword) {
    return false;
  }

  return constantTimeEqual(password, expectedPassword);
}
