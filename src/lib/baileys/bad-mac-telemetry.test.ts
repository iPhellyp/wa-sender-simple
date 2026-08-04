import assert from "node:assert/strict";
import test from "node:test";
import type { BaileysEventMap, WAMessage } from "@whiskeysockets/baileys";
import {
  BadMacTelemetry,
  classifyJid,
  hashTechnicalIdentifier
} from "./bad-mac-telemetry";

function messageFixture() {
  return {
    key: {
      id: "message-id-that-must-never-be-logged",
      remoteJid: "5511999990000@s.whatsapp.net",
      participant: "5511888880000@s.whatsapp.net",
      fromMe: false
    },
    message: {
      conversation: "texto privado que nunca deve aparecer na telemetria"
    }
  } as unknown as WAMessage;
}

function upsertFixture(): BaileysEventMap["messages.upsert"] {
  return {
    type: "notify",
    messages: [messageFixture()]
  } as BaileysEventMap["messages.upsert"];
}

test("technical hashes are stable and do not expose the source", () => {
  const source = "5511999990000@s.whatsapp.net";
  const first = hashTechnicalIdentifier(source);
  const second = hashTechnicalIdentifier(source);

  assert.equal(first, second);
  assert.ok(first);
  assert.notEqual(first, source);
  assert.doesNotMatch(first, /5511999990000/);
});

test("JID categories do not expose the complete identifier", () => {
  assert.equal(classifyJid("123@lid"), "LID");
  assert.equal(classifyJid("5511999990000@s.whatsapp.net"), "PN");
  assert.equal(classifyJid("123-456@g.us"), "GROUP");
  assert.equal(classifyJid("status@broadcast"), "BROADCAST");
  assert.equal(classifyJid("opaque@example"), "OTHER");
});

test("Bad MAC receives a correlation ID and sanitized batch outcome", () => {
  const entries: Array<Record<string, unknown>> = [];
  const telemetry = new BadMacTelemetry("instance-private-id", (entry) => entries.push(entry));

  telemetry.inspectLoggerArguments([new Error("Bad MAC")]);
  const context = telemetry.observeMessagesUpsert(upsertFixture());
  telemetry.recordMessagesUpsertResult(context, {
    messageCount: 1,
    processed: 0,
    skipped: 1,
    failed: 0
  });

  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /message-id-that-must-never-be-logged/);
  assert.doesNotMatch(serialized, /5511999990000/);
  assert.doesNotMatch(serialized, /texto privado/);
  assert.doesNotMatch(serialized, /instance-private-id/);

  const observed = entries.find((entry) => entry.event === "bad_mac_observed");
  const correlated = entries.find((entry) => entry.event === "bad_mac_correlated");
  const result = entries.find((entry) => entry.event === "messages_upsert_result");

  assert.ok(observed?.eventCorrelationId);
  assert.ok(correlated?.eventCorrelationId);
  assert.equal(correlated?.isRealtimeNotify, true);
  assert.equal(result?.processedCount, 0);
  assert.equal(result?.persistedCount, 0);
  assert.equal(result?.skippedCount, 1);
  assert.equal(result?.failedCount, 0);
  assert.equal(result?.possibleLoss, null);
});

test("normal Pino records are ignored and partial batches keep their counts", () => {
  const entries: Array<Record<string, unknown>> = [];
  const telemetry = new BadMacTelemetry("instance", (entry) => entries.push(entry));

  telemetry.inspectLoggerArguments([{ level: 30, msg: "normal operational record" }]);
  assert.equal(entries.length, 0);

  telemetry.inspectLoggerArguments([new Error("Bad MAC")]);
  const first = messageFixture();
  const second = messageFixture();
  second.key = { ...second.key, id: "second-private-id" };
  const context = telemetry.observeMessagesUpsert({
    type: "notify",
    messages: [first, second]
  } as BaileysEventMap["messages.upsert"]);
  telemetry.recordMessagesUpsertResult(context, {
    messageCount: 2,
    processed: 1,
    skipped: 1,
    failed: 0
  });

  const result = entries.find((entry) => entry.event === "messages_upsert_result");
  assert.equal(result?.messageCount, 2);
  assert.equal(result?.processedCount, 1);
  assert.equal(result?.skippedCount, 1);
  assert.equal(result?.failedCount, 0);
  assert.equal(result?.possibleLoss, false);
});

test("each telemetry instance gets an independent socket generation", () => {
  const first = new BadMacTelemetry("instance");
  const second = new BadMacTelemetry("instance");

  assert.notEqual(first.socketGenerationId, second.socketGenerationId);
});

test("reconnect is emitted as follow-up without changing socket behavior", () => {
  const entries: Array<Record<string, unknown>> = [];
  const telemetry = new BadMacTelemetry("instance", (entry) => entries.push(entry));

  telemetry.inspectLoggerArguments([new Error("Bad MAC")]);
  telemetry.observeConnectionUpdate("close");
  telemetry.observeConnectionUpdate("open");

  const followUps = entries.filter((entry) => entry.event === "bad_mac_follow_up");
  assert.equal(followUps.length, 2);
  assert.equal(followUps[0]?.socketClosedWithin30Seconds, true);
  assert.equal(followUps[1]?.reconnectWithin30Seconds, true);
});
