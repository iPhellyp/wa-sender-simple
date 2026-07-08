export const WHATSAPP_X1_ONLY_MODE = true;
export const FAST_LABEL_SENDER_MODE = true;
export const CATALOG_BOOTSTRAP_MODE = true;

const X1_GROUP_SKIP_LOG_INTERVAL_MS = 60_000;
const x1GroupSkipCounts = {
  chats: 0,
  contacts: 0,
  labels: 0,
  messages: 0
};
let x1GroupSkipLogTimer: ReturnType<typeof setTimeout> | null = null;

type X1GroupSkipScope = keyof typeof x1GroupSkipCounts;

function flushX1GroupSkipSummary() {
  x1GroupSkipLogTimer = null;

  const total = Object.values(x1GroupSkipCounts).reduce((sum, count) => sum + count, 0);

  if (total > 0) {
    console.log("[x1-only] group skips summary", {
      ...x1GroupSkipCounts,
      total
    });
  }

  x1GroupSkipCounts.chats = 0;
  x1GroupSkipCounts.contacts = 0;
  x1GroupSkipCounts.labels = 0;
  x1GroupSkipCounts.messages = 0;
}

export function recordX1GroupSkips(scope: X1GroupSkipScope, count = 1) {
  if (count <= 0) {
    return;
  }

  x1GroupSkipCounts[scope] += count;

  if (!x1GroupSkipLogTimer) {
    x1GroupSkipLogTimer = setTimeout(flushX1GroupSkipSummary, X1_GROUP_SKIP_LOG_INTERVAL_MS);
    (x1GroupSkipLogTimer as { unref?: () => void }).unref?.();
  }
}

export function isGroupJid(jid: string | null | undefined) {
  return Boolean(jid?.trim().toLowerCase().includes("@g.us"));
}

export function isBroadcastOrNewsletterJid(jid: string | null | undefined) {
  const normalized = jid?.trim().toLowerCase() ?? "";

  return (
    !normalized ||
    normalized === "status@broadcast" ||
    normalized.includes("broadcast") ||
    normalized.includes("newsletter") ||
    normalized.includes("channel")
  );
}

export function isIndividualJid(jid: string | null | undefined) {
  const normalized = jid?.trim().toLowerCase() ?? "";

  return (
    !shouldIgnoreJidForX1Only(normalized) &&
    (normalized.endsWith("@s.whatsapp.net") ||
      normalized.endsWith("@c.us") ||
      normalized.endsWith("@lid"))
  );
}

export function shouldIgnoreJidForX1Only(jid: string | null | undefined) {
  if (!WHATSAPP_X1_ONLY_MODE) {
    return false;
  }

  return isGroupJid(jid) || isBroadcastOrNewsletterJid(jid);
}
