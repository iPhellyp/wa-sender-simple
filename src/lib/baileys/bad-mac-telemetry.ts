import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { BaileysEventMap, WAMessage } from "@whiskeysockets/baileys";

const TELEMETRY_HMAC_KEY = randomBytes(32);
const CORRELATION_WINDOW_MS = 5_000;
const FOLLOW_UP_WINDOW_MS = 30_000;
const MAX_HASHES_PER_BATCH = 100;

export const BAILEYS_LOG_REDACT_PATHS = [
  "auth",
  "authState",
  "creds",
  "keys",
  "token",
  "cookie",
  "password",
  "jid",
  "remoteJid",
  "remoteJidAlt",
  "participant",
  "participantAlt",
  "*.auth",
  "*.authState",
  "*.creds",
  "*.keys",
  "*.token",
  "*.cookie",
  "*.password",
  "*.jid",
  "*.remoteJid",
  "*.remoteJidAlt",
  "*.participant",
  "*.participantAlt"
];

export type TelemetrySink = (entry: Record<string, unknown>) => void;

type LoggerInput = unknown[];

type PendingBadMac = {
  eventCorrelationId: string;
  observedAt: number;
  record: Record<string, unknown>;
  correlated: boolean;
};

export type MessageUpsertTelemetryResult = {
  messageCount: number;
  processed: number;
  skipped: number;
  failed: number;
};

export type MessageUpsertTelemetryContext = {
  batchCorrelationId: string;
  badMacEventCorrelationIds: string[];
  startedAt: number;
};

function defaultSink(entry: Record<string, unknown>) {
  console.warn("[baileys-telemetry]", JSON.stringify(entry));
}

function technicalId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function hashTechnicalIdentifier(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return createHmac("sha256", TELEMETRY_HMAC_KEY)
    .update(value)
    .digest("hex")
    .slice(0, 24);
}

export function classifyJid(jid: string | null | undefined) {
  if (!jid) {
    return "OTHER" as const;
  }

  const normalized = jid.trim().toLowerCase();

  if (normalized.endsWith("@lid")) {
    return "LID" as const;
  }

  if (normalized.endsWith("@s.whatsapp.net") || normalized.endsWith("@c.us")) {
    return "PN" as const;
  }

  if (normalized.endsWith("@g.us")) {
    return "GROUP" as const;
  }

  if (
    normalized.endsWith("@broadcast") ||
    normalized === "status@broadcast" ||
    normalized.endsWith("@newsletter")
  ) {
    return "BROADCAST" as const;
  }

  return "OTHER" as const;
}

function getObjectValue(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") {
    return undefined;
  }

  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
}

function getStringValue(source: unknown, keys: string[]) {
  const value = getObjectValue(source, keys);
  return typeof value === "string" ? value : null;
}

function getNumberValue(source: unknown, keys: string[]) {
  const value = getObjectValue(source, keys);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function containsBadMac(value: unknown, depth = 0): boolean {
  if (depth > 3 || value === null || value === undefined) {
    return false;
  }

  if (value instanceof Error) {
    return `${value.name} ${value.message}`.toLowerCase().includes("bad mac");
  }

  if (typeof value === "string") {
    return value.toLowerCase().includes("bad mac");
  }

  if (typeof value !== "object") {
    return false;
  }

  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (["auth", "authState", "creds", "keys", "token", "cookie"].includes(key)) {
      return false;
    }

    return containsBadMac(child, depth + 1);
  });
}

function findErrorValue(input: LoggerInput): unknown {
  for (const value of input) {
    if (value instanceof Error) {
      return value;
    }

    if (value && typeof value === "object") {
      const candidate = getObjectValue(value, ["error", "err", "cause"]);
      if (candidate && typeof candidate === "object") {
        return candidate;
      }
    }
  }

  return null;
}

function stackFingerprint(input: LoggerInput) {
  const error = findErrorValue(input);
  const stack =
    (error instanceof Error ? error.stack : getStringValue(error, ["stack"])) ??
    input.map((value) => getStringValue(value, ["stack"])).find(Boolean);
  return hashTechnicalIdentifier(stack);
}

function loggerErrorName(input: LoggerInput) {
  const error = findErrorValue(input);
  return (
    (error instanceof Error ? error.name : getStringValue(error, ["name", "type"])) ??
    getStringValue(input[0], ["errorName", "name"]) ??
    "Error"
  );
}

function loggerErrorCode(input: LoggerInput) {
  const error = findErrorValue(input);
  return (
    getStringValue(error, ["code", "statusCode"]) ??
    getNumberValue(error, ["code", "statusCode"]) ??
    getStringValue(input[0], ["errorCode", "code", "statusCode"]) ??
    getNumberValue(input[0], ["errorCode", "code", "statusCode"])
  );
}

function safeEventName(input: LoggerInput) {
  const value = getStringValue(input[0], ["eventName", "event"]);
  return value && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : null;
}

function safeStanzaType(input: LoggerInput) {
  const value = getStringValue(input[0], ["stanzaType", "stanza", "tag", "nodeTag"]);
  return value && /^[a-z0-9_.:-]{1,80}$/i.test(value) ? value : null;
}

function safeRetryCount(input: LoggerInput) {
  return getNumberValue(input[0], ["retryCount", "retry", "attempt", "attempts"]);
}

function messageType(message: WAMessage) {
  const content = message.message;
  if (!content || typeof content !== "object") {
    return null;
  }

  const [firstType] = Object.keys(content);
  return firstType ?? null;
}

function sanitizeMessage(message: WAMessage) {
  const key = message.key as typeof message.key & {
    remoteJidAlt?: string | null;
    participantAlt?: string | null;
  };
  const remoteJid = key.remoteJid ?? null;
  const participant = key.participant ?? message.participant ?? null;

  return {
    direction: key.fromMe === true ? "OUTBOUND" : "INBOUND",
    jidCategory: classifyJid(remoteJid),
    participantCategory: classifyJid(participant),
    hasRemoteJidAlt: Boolean(key.remoteJidAlt),
    hasParticipantAlt: Boolean(key.participantAlt),
    messageType: messageType(message),
    messageIdHash: hashTechnicalIdentifier(key.id ?? null),
    remoteJidHash: hashTechnicalIdentifier(remoteJid),
    participantHash: hashTechnicalIdentifier(participant)
  };
}

function sanitizeLoggerContext(input: LoggerInput) {
  return {
    eventName: safeEventName(input),
    stanzaType: safeStanzaType(input),
    retryCount: safeRetryCount(input),
    errorName: loggerErrorName(input),
    errorCode: loggerErrorCode(input),
    stackFingerprint: stackFingerprint(input)
  };
}

export class BadMacTelemetry {
  readonly socketGenerationId = technicalId("socket");

  private readonly startedAt = Date.now();
  private readonly sink: TelemetrySink;
  private readonly pending: PendingBadMac[] = [];
  private connectionState = "starting";
  private lastReconnectAt: number | null = null;

  constructor(
    private readonly instanceId: string,
    sink: TelemetrySink = defaultSink
  ) {
    this.sink = sink;
  }

  inspectLoggerArguments(input: LoggerInput) {
    this.prunePending(Date.now());

    if (!containsBadMac(input)) {
      return null;
    }

    const observedAt = Date.now();
    const eventCorrelationId = technicalId("event");
    const context = sanitizeLoggerContext(input);
    const record: Record<string, unknown> = {
      timestampUtc: new Date(observedAt).toISOString(),
      instanceIdHash: hashTechnicalIdentifier(this.instanceId),
      socketGenerationId: this.socketGenerationId,
      eventCorrelationId,
      connectionState: this.connectionState,
      eventName: context.eventName ?? "bad_mac",
      stanzaType: context.stanzaType,
      messageType: null,
      isHistorySync: false,
      isRealtimeNotify: null,
      direction: null,
      jidCategory: "OTHER",
      participantCategory: "OTHER",
      hasRemoteJidAlt: false,
      hasParticipantAlt: false,
      retryCount: context.retryCount,
      messageIdHash: null,
      remoteJidHash: null,
      participantHash: null,
      errorName: context.errorName,
      errorCode: context.errorCode,
      stackFingerprint: context.stackFingerprint,
      socketAgeSeconds: Math.floor((observedAt - this.startedAt) / 1000),
      millisecondsSinceLastReconnect: this.lastReconnectAt === null ? null : observedAt - this.lastReconnectAt,
      persistedBeforeError: null,
      persistedAfterError: null,
      duplicateDetected: null,
      socketClosedWithin30Seconds: false,
      reconnectWithin30Seconds: false
    };

    this.pending.push({
      eventCorrelationId,
      observedAt,
      record,
      correlated: false
    });
    this.sink({ event: "bad_mac_observed", ...record });

    return eventCorrelationId;
  }

  observeConnectionUpdate(connection: string | null | undefined) {
    const now = Date.now();
    this.prunePending(now);

    if (connection === "open") {
      if (this.connectionState !== "starting" && this.connectionState !== "connected") {
        this.lastReconnectAt = now;
        this.followUpPending("reconnectWithin30Seconds", true);
      }
      this.connectionState = "connected";
      return;
    }

    if (connection === "close") {
      this.followUpPending("socketClosedWithin30Seconds", true);
      this.connectionState = "closed";
    }
  }

  observeMessagesUpsert(event: BaileysEventMap["messages.upsert"]): MessageUpsertTelemetryContext {
    const batchCorrelationId = technicalId("batch");
    const observedAt = Date.now();
    this.prunePending(observedAt);
    const messages = event.messages.slice(0, MAX_HASHES_PER_BATCH);
    const summaries = messages.map(sanitizeMessage);
    const matchingPending = this.pending.filter(
      (pending) => !pending.correlated && observedAt - pending.observedAt >= -100 && observedAt - pending.observedAt <= CORRELATION_WINDOW_MS
    );

    for (const [index, pending] of matchingPending.entries()) {
      const summary = summaries[index % Math.max(summaries.length, 1)];
      pending.correlated = true;
      const correlatedRecord = {
        ...pending.record,
        eventName: "messages.upsert",
        eventCorrelationId: pending.eventCorrelationId,
        batchCorrelationId,
        isHistorySync: false,
        isRealtimeNotify: event.type === "notify",
        ...(summary ?? {})
      };
      this.sink({ event: "bad_mac_correlated", ...correlatedRecord });
    }

    this.sink({
      event: "messages_upsert_observed",
      timestampUtc: new Date(observedAt).toISOString(),
      instanceIdHash: hashTechnicalIdentifier(this.instanceId),
      socketGenerationId: this.socketGenerationId,
      eventCorrelationId: batchCorrelationId,
      upsertType: event.type,
      messageCount: event.messages.length,
      messageIdHashes: summaries.map((summary) => summary.messageIdHash),
      remoteJidHashes: summaries.map((summary) => summary.remoteJidHash),
      badMacCountCorrelated: matchingPending.length
    });

    return {
      batchCorrelationId,
      badMacEventCorrelationIds: matchingPending.map((pending) => pending.eventCorrelationId),
      startedAt: observedAt
    };
  }

  recordMessagesUpsertResult(
    context: MessageUpsertTelemetryContext,
    result: MessageUpsertTelemetryResult
  ) {
    const possibleLoss =
      context.badMacEventCorrelationIds.length === 0
        ? false
        : result.failed > 0
          ? true
          : result.processed > 0
            ? false
            : null;

    this.sink({
      event: "messages_upsert_result",
      timestampUtc: new Date().toISOString(),
      instanceIdHash: hashTechnicalIdentifier(this.instanceId),
      socketGenerationId: this.socketGenerationId,
      eventCorrelationId: context.batchCorrelationId,
      messageCount: result.messageCount,
      processedCount: result.processed,
      persistedCount: result.processed,
      skippedCount: result.skipped,
      failedCount: result.failed,
      decryptErrorCount: context.badMacEventCorrelationIds.length,
      retryRecoveredCount: null,
      duplicateDetected: null,
      possibleLoss,
      durationMs: Math.max(0, Date.now() - context.startedAt)
    });

    for (const badMacEventCorrelationId of context.badMacEventCorrelationIds) {
      this.sink({
        event: "bad_mac_outcome",
        timestampUtc: new Date().toISOString(),
        instanceIdHash: hashTechnicalIdentifier(this.instanceId),
        socketGenerationId: this.socketGenerationId,
        eventCorrelationId: badMacEventCorrelationId,
        persistedBeforeError: null,
        persistedAfterError: result.processed > 0,
        duplicateDetected: null,
        possibleLoss,
        processedCount: result.processed,
        skippedCount: result.skipped,
        failedCount: result.failed,
        retryRecovered: null
      });
    }
  }

  observeReceiptUpdates(updates: unknown[]) {
    this.prunePending(Date.now());

    this.sink({
      event: "message_receipt_update_observed",
      timestampUtc: new Date().toISOString(),
      instanceIdHash: hashTechnicalIdentifier(this.instanceId),
      socketGenerationId: this.socketGenerationId,
      eventCorrelationId: technicalId("receipt"),
      receiptCount: updates.length
    });
  }

  dispose() {
    this.pending.length = 0;
  }

  private followUpPending(field: "socketClosedWithin30Seconds" | "reconnectWithin30Seconds", value: boolean) {
    const now = Date.now();

    for (const pending of this.pending) {
      if (now - pending.observedAt < 0 || now - pending.observedAt > FOLLOW_UP_WINDOW_MS) {
        continue;
      }

      this.sink({
        event: "bad_mac_follow_up",
        timestampUtc: new Date(now).toISOString(),
        instanceIdHash: hashTechnicalIdentifier(this.instanceId),
        socketGenerationId: this.socketGenerationId,
        eventCorrelationId: pending.eventCorrelationId,
        [field]: value,
        socketAgeSeconds: Math.floor((now - this.startedAt) / 1000),
        millisecondsSinceLastReconnect: this.lastReconnectAt === null ? null : now - this.lastReconnectAt
      });
    }
  }

  private prunePending(now: number) {
    const firstLiveIndex = this.pending.findIndex(
      (pending) => now - pending.observedAt <= FOLLOW_UP_WINDOW_MS
    );

    if (firstLiveIndex > 0) {
      this.pending.splice(0, firstLiveIndex);
    }
  }
}
