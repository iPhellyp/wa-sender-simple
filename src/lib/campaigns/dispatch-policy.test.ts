import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  forecastDispatch,
  getDispatchDay,
  nextDispatchDecision,
  progressivePauseMinutes,
  randomDelayMs,
  validateDispatchSettings
} from "./dispatch-policy";
import {
  isSerializableTransactionConflict,
  MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS
} from "./transaction-conflict";

const settings = {
  delayMode: "random_range" as const,
  minDelaySeconds: 30,
  maxDelaySeconds: 90,
  dailyLimit: 600,
  timezone: "America/Sao_Paulo",
  windowStart: "06:00",
  windowEnd: "22:00",
  continueNextDay: true,
  pauseAfter25Minutes: 5,
  pauseAfter50Minutes: 10,
  pauseAfter75Minutes: 15,
  pauseAfter100Minutes: 20
};

test("progressive pauses use the current 100-message cycle", () => {
  assert.equal(progressivePauseMinutes(24, settings), 0);
  assert.equal(progressivePauseMinutes(25, settings), 5);
  assert.equal(progressivePauseMinutes(49, settings), 0);
  assert.equal(progressivePauseMinutes(50, settings), 10);
  assert.equal(progressivePauseMinutes(74, settings), 0);
  assert.equal(progressivePauseMinutes(75, settings), 15);
  assert.equal(progressivePauseMinutes(99, settings), 0);
  assert.equal(progressivePauseMinutes(100, settings), 20);
  assert.equal(progressivePauseMinutes(124, settings), 0);
  assert.equal(progressivePauseMinutes(125, settings), 5);
  assert.equal(progressivePauseMinutes(199, settings), 0);
  assert.equal(progressivePauseMinutes(200, settings), 20);
});

test("random delay stays inside the configured range", () => {
  assert.equal(randomDelayMs(settings, () => 0), 30_000);
  assert.equal(randomDelayMs(settings, () => 0.5), 60_000);
  assert.equal(randomDelayMs(settings, () => 1), 90_000);
  assert.equal(validateDispatchSettings({ ...settings, maxDelaySeconds: 29 }), "Intervalo maximo deve ser maior ou igual ao minimo");
});

test("daily window uses campaign timezone and handles day rollover", () => {
  const beforeOpening = new Date("2026-07-11T08:00:00.000Z");
  const day = getDispatchDay(beforeOpening, settings);
  assert.equal(day.windowStart.toISOString(), "2026-07-11T09:00:00.000Z");
  const decision = nextDispatchDecision({ now: beforeOpening, settings, sentToday: 0, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(decision.nextAt?.toISOString(), day.windowStart.toISOString());

  const afterClosing = new Date("2026-07-12T02:00:00.000Z");
  const next = nextDispatchDecision({ now: afterClosing, settings, sentToday: 10, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(next.nextAt?.toISOString(), "2026-07-12T09:00:00.000Z");
});

test("daily limit preserves pending work for the next day", () => {
  const now = new Date("2026-07-11T20:00:00.000Z");
  const next = nextDispatchDecision({ now, settings, sentToday: 600, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(next.pauseCampaign, false);
  assert.equal(next.nextAt?.toISOString(), "2026-07-12T09:00:00.000Z");
  const stopped = nextDispatchDecision({ now, settings: { ...settings, continueNextDay: false }, sentToday: 600, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(stopped.pauseCampaign, true);
  assert.equal(stopped.nextAt, null);
});

test("progressive cycle continues across daily boundaries", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const decision = nextDispatchDecision({ now, settings, sentToday: 1, sentInCycle: 125, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(decision.nextAt?.getTime(), now.getTime() + 5 * 60_000);
});

test("last recipient and last daily recipient do not receive a final pause", () => {
  const last = nextDispatchDecision({ now: new Date("2026-07-11T12:00:00.000Z"), settings, sentToday: 25, hasPending: false, fallbackDelayMs: 0, random: () => 0 });
  assert.equal(last.nextAt?.getTime(), new Date("2026-07-11T12:00:30.000Z").getTime());
  const limit = nextDispatchDecision({ now: new Date("2026-07-11T20:00:00.000Z"), settings, sentToday: 600, hasPending: false, fallbackDelayMs: 0 });
  assert.equal(limit.nextAt?.toISOString(), "2026-07-12T09:00:00.000Z");
});

test("forecast for 600 messages is close to 20:40 and 2100 spans four days", () => {
  const start = new Date("2026-07-11T09:00:00.000Z");
  const day = forecastDispatch(600, start, settings);
  const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: settings.timezone, hour: "2-digit", hourCycle: "h23" }).format(day.expected));
  assert.ok(localHour >= 20 && localHour <= 21);
  assert.equal(day.estimatedDays, 1);
  assert.equal(forecastDispatch(2100, start, settings).estimatedDays, 4);
});

test("legacy campaign without daily settings keeps the previous delay behavior", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const decision = nextDispatchDecision({ now, settings: { delayMode: "fixed_seconds", fixedSeconds: 60 }, sentToday: 3, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(decision.nextAt?.getTime(), now.getTime() + 60_000);
});

test("fixed seconds forecast ignores random range values", () => {
  const start = new Date("2026-07-11T12:00:00.000Z");
  const forecast = forecastDispatch(2, start, {
    ...settings,
    delayMode: "fixed_seconds",
    fixedSeconds: 45,
    minDelaySeconds: Number.NaN,
    maxDelaySeconds: -1
  });
  assert.equal(forecast.expected.getTime() - start.getTime(), 45_000);
  assert.equal(forecast.optimistic.getTime(), forecast.pessimistic.getTime());
});

test("fixed minutes forecast converts minutes to seconds and ignores random range", () => {
  const start = new Date("2026-07-11T12:00:00.000Z");
  const forecast = forecastDispatch(2, start, {
    ...settings,
    delayMode: "fixed_minutes",
    fixedMinutes: 2,
    minDelaySeconds: Number.NaN,
    maxDelaySeconds: -1
  });
  assert.equal(forecast.expected.getTime() - start.getTime(), 120_000);
});

test("daily limit boundary schedules only when the limit is reached", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const before = nextDispatchDecision({ now, settings, sentToday: 599, hasPending: true, fallbackDelayMs: 0, random: () => 0 });
  const exact = nextDispatchDecision({ now, settings, sentToday: 600, hasPending: true, fallbackDelayMs: 0 });
  const after = nextDispatchDecision({ now, settings, sentToday: 601, hasPending: true, fallbackDelayMs: 0 });
  assert.equal(before.nextAt?.toISOString(), "2026-07-11T12:00:30.000Z");
  assert.equal(exact.nextAt?.toISOString(), "2026-07-12T09:00:00.000Z");
  assert.equal(after.nextAt?.toISOString(), "2026-07-12T09:00:00.000Z");
});

test("forecast does not silently continue when continueNextDay is false", () => {
  assert.throws(
    () => forecastDispatch(601, new Date("2026-07-11T09:00:00.000Z"), { ...settings, continueNextDay: false }),
    /sem continuacao/
  );
});

test("forecast dates are finite and never precede the requested start", () => {
  const start = new Date("2026-07-11T12:00:00.000Z");
  const forecast = forecastDispatch(10, start, settings);
  for (const value of [forecast.optimistic, forecast.expected, forecast.pessimistic]) {
    assert.equal(Number.isFinite(value.getTime()), true);
    assert.ok(value.getTime() >= start.getTime());
  }
});

test("serializable retry helper recognizes only Prisma P2034 conflicts", () => {
  const conflict = new Prisma.PrismaClientKnownRequestError("conflict", {
    code: "P2034",
    clientVersion: "test"
  });
  const unknownPrismaError = new Prisma.PrismaClientKnownRequestError("unknown", {
    code: "P2002",
    clientVersion: "test"
  });
  assert.equal(MAX_SERIALIZABLE_TRANSACTION_ATTEMPTS, 3);
  assert.equal(isSerializableTransactionConflict(conflict), true);
  assert.equal(isSerializableTransactionConflict(unknownPrismaError), false);
  assert.equal(isSerializableTransactionConflict(new Error("P2034")), false);
});

test("short window limits first-day capacity even when daily limit is high", () => {
  const forecast = forecastDispatch(10, new Date("2026-07-11T12:00:00.000Z"), {
    ...settings,
    delayMode: "fixed_seconds",
    fixedSeconds: 60,
    dailyLimit: 1_000,
    windowStart: "09:00",
    windowEnd: "09:05"
  });
  assert.equal(forecast.firstDayCapacity, 6);
  assert.equal(forecast.remainingAfterFirstDay, 4);
  assert.equal(forecast.estimatedDays, 2);
});

test("first-day capacity uses only the window time remaining at campaign start", () => {
  const forecast = forecastDispatch(3, new Date("2026-07-11T12:04:00.000Z"), {
    ...settings,
    delayMode: "fixed_seconds",
    fixedSeconds: 60,
    dailyLimit: 1_000,
    windowStart: "09:00",
    windowEnd: "09:05"
  });
  assert.equal(forecast.firstDayCapacity, 2);
  assert.equal(forecast.remainingAfterFirstDay, 1);
  assert.equal(forecast.estimatedDays, 2);
});

test("forecast completed on the same local date reports one day", () => {
  const forecast = forecastDispatch(2, new Date("2026-07-11T12:00:00.000Z"), {
    ...settings,
    delayMode: "fixed_seconds",
    fixedSeconds: 60
  });
  assert.equal(forecast.estimatedDays, 1);
});

test("forecast completed on the next local date reports two days", () => {
  const forecast = forecastDispatch(2, new Date("2026-07-12T01:00:30.000Z"), {
    ...settings,
    delayMode: "fixed_seconds",
    fixedSeconds: 60,
    windowStart: "06:00",
    windowEnd: "22:00"
  });
  assert.equal(forecast.estimatedDays, 2);
});

test("estimated days use campaign local dates instead of UTC dates", () => {
  const forecast = forecastDispatch(2, new Date("2026-07-11T09:59:00.000Z"), {
    ...settings,
    delayMode: "fixed_seconds",
    fixedSeconds: 120,
    timezone: "Pacific/Kiritimati",
    windowStart: "00:00",
    windowEnd: "23:59"
  });
  assert.equal(forecast.expected.toISOString(), "2026-07-11T10:00:00.000Z");
  assert.equal(forecast.estimatedDays, 2);
});

test("forecast variants remain finite and ordered", () => {
  const forecast = forecastDispatch(20, new Date("2026-07-11T12:00:00.000Z"), settings);
  const times = [forecast.optimistic, forecast.expected, forecast.pessimistic].map((date) => date.getTime());
  assert.equal(times.every(Number.isFinite), true);
  assert.ok(times[0] <= times[1]);
  assert.ok(times[1] <= times[2]);
});
