export const ACTIVE_INSTANCE_STORAGE_KEY = "wa_sender_active_instance_id";
export const ACTIVE_INSTANCE_COOKIE_NAME = "wa_sender_active_instance_id";

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

export function getInstanceIdFromUrl() {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("instanceId")?.trim() ?? "";
}

export function getStoredActiveInstanceId() {
  if (typeof window === "undefined") {
    return "";
  }

  const urlInstanceId = getInstanceIdFromUrl();

  if (urlInstanceId) {
    return urlInstanceId;
  }

  const localInstanceId = window.localStorage.getItem(ACTIVE_INSTANCE_STORAGE_KEY)?.trim() ?? "";

  if (localInstanceId) {
    return localInstanceId;
  }

  const cookieValue = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ACTIVE_INSTANCE_COOKIE_NAME}=`));

  return cookieValue
    ? decodeURIComponent(cookieValue.split("=").slice(1).join("=")).trim()
    : "";
}

export function setStoredActiveInstanceId(instanceId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedInstanceId = instanceId.trim();

  if (normalizedInstanceId) {
    window.localStorage.setItem(ACTIVE_INSTANCE_STORAGE_KEY, normalizedInstanceId);
    document.cookie = `${ACTIVE_INSTANCE_COOKIE_NAME}=${encodeURIComponent(
      normalizedInstanceId
    )}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } else {
    window.localStorage.removeItem(ACTIVE_INSTANCE_STORAGE_KEY);
    document.cookie = `${ACTIVE_INSTANCE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  window.dispatchEvent(
    new CustomEvent("wa-sender-active-instance-changed", {
      detail: { instanceId: normalizedInstanceId }
    })
  );
}

export function appendInstanceIdToHref(href: string, instanceId: string) {
  const normalizedInstanceId = instanceId.trim();

  if (!normalizedInstanceId) {
    return href;
  }

  const [path, hash = ""] = href.split("#");
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("instanceId", normalizedInstanceId);
  const resolvedQuery = params.toString();
  const resolvedHash = hash ? `#${hash}` : "";

  return `${pathname}${resolvedQuery ? `?${resolvedQuery}` : ""}${resolvedHash}`;
}
