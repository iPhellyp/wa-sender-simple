export type CampaignDispatchSettings = {
  delayMode?: "fixed_seconds" | "fixed_minutes" | "random_range";
  fixedSeconds?: number;
  fixedMinutes?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  pauseEvery?: number;
  pauseMinutes?: number;
  batchLimit?: number;
  dailyLimit?: number;
  timezone?: string;
  windowStart?: string;
  windowEnd?: string;
  continueNextDay?: boolean;
  pauseAfter25Minutes?: number;
  pauseAfter50Minutes?: number;
  pauseAfter75Minutes?: number;
  pauseAfter100Minutes?: number;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function parseDispatchSettings(value: string | null): CampaignDispatchSettings {
  if (!value?.startsWith("settings:")) return {};
  try {
    const parsed = JSON.parse(value.slice("settings:".length));
    return parsed && typeof parsed === "object" ? parsed as CampaignDispatchSettings : {};
  } catch {
    return {};
  }
}

export function resolveDispatchSettings(config: unknown, legacyValue: string | null) {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as CampaignDispatchSettings;
  }
  return parseDispatchSettings(legacyValue);
}

export function validateDispatchSettings(settings: CampaignDispatchSettings) {
  if (settings.dailyLimit === undefined) return null;
  if (!Number.isInteger(settings.dailyLimit) || Number(settings.dailyLimit) < 1) return "Limite diario deve ser inteiro e maior que zero";
  if (!settings.timezone || !isValidTimezone(settings.timezone)) return "Timezone da campanha invalido";
  try {
    const start = parseClock(settings.windowStart, "06:00");
    const end = parseClock(settings.windowEnd, "22:00");
    if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) return "Fim da janela deve ser posterior ao inicio";
  } catch (error) {
    return error instanceof Error ? error.message : "Janela diaria invalida";
  }
  if (settings.delayMode === "fixed_seconds") {
    const seconds = Number(settings.fixedSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return "Intervalo fixo em segundos deve ser maior que zero";
  } else if (settings.delayMode === "fixed_minutes") {
    const minutes = Number(settings.fixedMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) return "Intervalo fixo em minutos deve ser maior que zero";
  } else {
    const min = Number(settings.minDelaySeconds);
    const max = Number(settings.maxDelaySeconds);
    if (!Number.isFinite(min) || min <= 0) return "Intervalo minimo deve ser maior que zero";
    if (!Number.isFinite(max) || max < min) return "Intervalo maximo deve ser maior ou igual ao minimo";
  }
  for (const value of [settings.pauseAfter25Minutes, settings.pauseAfter50Minutes, settings.pauseAfter75Minutes, settings.pauseAfter100Minutes]) {
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) return "Pausas progressivas devem ser inteiros nao negativos";
  }
  return null;
}

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function localParts(date: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

function zonedDate(parts: LocalParts, timezone: string) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(candidate), timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    candidate += desired - represented;
  }
  return new Date(candidate);
}

function parseClock(value: string | undefined, fallback: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value ?? fallback);
  if (!match) throw new Error("Horario diario invalido");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error("Horario diario invalido");
  return { hour, minute };
}

function shiftLocalDay(parts: LocalParts, days: number): LocalParts {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), hour: 0, minute: 0, second: 0 };
}

function localDayNumber(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

export function getDispatchDay(now: Date, settings: CampaignDispatchSettings) {
  const timezone = settings.timezone ?? "America/Sao_Paulo";
  if (!isValidTimezone(timezone)) throw new Error("Timezone da campanha invalido");
  const current = localParts(now, timezone);
  const startClock = parseClock(settings.windowStart, "00:00");
  const endClock = parseClock(settings.windowEnd, "23:59");
  const day = { ...current, hour: 0, minute: 0, second: 0 };
  const start = zonedDate({ ...day, ...startClock }, timezone);
  const end = zonedDate({ ...day, ...endClock, second: 59 }, timezone);
  if (end.getTime() <= start.getTime()) throw new Error("Fim da janela deve ser posterior ao inicio");
  const nextDay = shiftLocalDay(current, 1);
  return {
    timezone,
    dayStart: zonedDate(day, timezone),
    dayEnd: zonedDate(nextDay, timezone),
    windowStart: start,
    windowEnd: end,
    nextWindowStart: zonedDate({ ...nextDay, ...startClock }, timezone)
  };
}

export function progressivePauseMinutes(sentToday: number, settings: CampaignDispatchSettings = {}) {
  if (sentToday <= 0) return 0;
  const position = ((sentToday - 1) % 100) + 1;
  if (position === 25) return settings.pauseAfter25Minutes ?? 5;
  if (position === 50) return settings.pauseAfter50Minutes ?? 10;
  if (position === 75) return settings.pauseAfter75Minutes ?? 15;
  if (position === 100) return settings.pauseAfter100Minutes ?? 20;
  return 0;
}

export function randomDelayMs(settings: CampaignDispatchSettings, random = Math.random) {
  if (settings.delayMode === "fixed_seconds") return Math.max(0, Number(settings.fixedSeconds ?? 0) * 1000);
  if (settings.delayMode === "fixed_minutes") return Math.max(0, Number(settings.fixedMinutes ?? 0) * 60_000);
  if (settings.delayMode === "random_range") {
    const min = Math.max(0, Number(settings.minDelaySeconds ?? 0));
    const max = Number(settings.maxDelaySeconds ?? min);
    if (max < min) throw new Error("Intervalo maximo nao pode ser menor que o minimo");
    return Math.round((min + random() * (max - min)) * 1000);
  }
  return 0;
}

export function nextDispatchDecision(params: {
  now: Date;
  settings: CampaignDispatchSettings;
  sentToday: number;
  sentInCycle?: number;
  hasPending: boolean;
  fallbackDelayMs: number;
  random?: () => number;
}) {
  const { now, settings, sentToday, hasPending } = params;
  const sentInCycle = params.sentInCycle ?? sentToday;
  const policyEnabled = Number.isInteger(settings.dailyLimit) && Number(settings.dailyLimit) > 0;
  if (!policyEnabled) {
    const pauseEvery = Number(settings.pauseEvery ?? 0);
    const pause =
      hasPending && Number.isInteger(pauseEvery) && pauseEvery > 0 && sentToday > 0 && sentToday % pauseEvery === 0
        ? Math.max(1, Number(settings.pauseMinutes ?? 1))
        : 0;
    return { nextAt: new Date(now.getTime() + (pause ? pause * 60_000 : randomDelayMs(settings, params.random) || params.fallbackDelayMs)), pauseCampaign: false };
  }
  const day = getDispatchDay(now, settings);
  if (now < day.windowStart) return { nextAt: day.windowStart, pauseCampaign: false };
  if (now > day.windowEnd || sentToday >= Number(settings.dailyLimit)) {
    return settings.continueNextDay === false
      ? { nextAt: null, pauseCampaign: true }
      : { nextAt: day.nextWindowStart, pauseCampaign: false };
  }
  const pause = hasPending && sentToday < Number(settings.dailyLimit) ? progressivePauseMinutes(sentInCycle, settings) : 0;
  const delay = pause ? pause * 60_000 : randomDelayMs(settings, params.random) || params.fallbackDelayMs;
  const candidate = new Date(now.getTime() + Math.max(0, delay));
  if (candidate <= day.windowEnd) return { nextAt: candidate, pauseCampaign: false };
  return settings.continueNextDay === false
    ? { nextAt: null, pauseCampaign: true }
    : { nextAt: day.nextWindowStart, pauseCampaign: false };
}

function simulateCompletion(total: number, start: Date, settings: CampaignDispatchSettings, delaySeconds: number) {
  if (total <= 0) return { completedAt: start, firstDayCapacity: 0 };
  let current = new Date(start);
  let sentToday = 0;
  let sent = 0;
  let firstOperationalDay: number | null = null;
  let firstDayCapacity = 0;
  let day = getDispatchDay(current, settings);
  while (sent < total) {
    if (current < day.windowStart) current = day.windowStart;
    if (current > day.windowEnd || sentToday >= Number(settings.dailyLimit)) {
      if (settings.continueNextDay === false) return null;
      current = day.nextWindowStart;
      sentToday = 0;
      day = getDispatchDay(current, settings);
      continue;
    }
    sent += 1;
    sentToday += 1;
    const sentDay = localDayNumber(current, day.timezone);
    if (firstOperationalDay === null) firstOperationalDay = sentDay;
    if (sentDay === firstOperationalDay) firstDayCapacity += 1;
    if (sent >= total) break;
    if (sentToday >= Number(settings.dailyLimit)) {
      if (settings.continueNextDay === false) return null;
      current = day.nextWindowStart;
      sentToday = 0;
      day = getDispatchDay(current, settings);
      continue;
    }
    const pause = progressivePauseMinutes(sent, settings);
    const candidate = new Date(current.getTime() + (pause ? pause * 60_000 : delaySeconds * 1000));
    if (candidate > day.windowEnd) {
      if (settings.continueNextDay === false) return null;
      current = day.nextWindowStart;
      sentToday = 0;
      day = getDispatchDay(current, settings);
    } else {
      current = candidate;
    }
  }
  return { completedAt: current, firstDayCapacity };
}

export function forecastDispatch(total: number, start: Date, settings: CampaignDispatchSettings) {
  const error = validateDispatchSettings(settings);
  if (error) throw new Error(error);
  const min =
    settings.delayMode === "fixed_seconds"
      ? Number(settings.fixedSeconds)
      : settings.delayMode === "fixed_minutes"
        ? Number(settings.fixedMinutes) * 60
        : Number(settings.minDelaySeconds);
  const max =
    settings.delayMode === "random_range"
      ? Number(settings.maxDelaySeconds)
      : min;
  const average = (min + max) / 2;
  const optimisticSimulation = simulateCompletion(total, start, settings, min);
  const expectedSimulation = simulateCompletion(total, start, settings, average);
  const pessimisticSimulation = simulateCompletion(total, start, settings, max);
  if (!optimisticSimulation || !expectedSimulation || !pessimisticSimulation) {
    throw new Error("Campanha nao pode ser concluida na janela atual sem continuacao no dia seguinte");
  }
  const optimistic = optimisticSimulation.completedAt;
  const expected = expectedSimulation.completedAt;
  const pessimistic = pessimisticSimulation.completedAt;
  const timezone = settings.timezone ?? "America/Sao_Paulo";
  const firstDayCapacity = expectedSimulation.firstDayCapacity;
  return {
    optimistic,
    expected,
    pessimistic,
    firstDayCapacity,
    remainingAfterFirstDay: Math.max(0, total - firstDayCapacity),
    estimatedDays: Math.max(1, localDayNumber(expected, timezone) - localDayNumber(start, timezone) + 1)
  };
}
