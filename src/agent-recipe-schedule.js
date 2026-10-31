const MAX_INTERVAL_MINUTES = 30 * 24 * 60;

export function normalizeScheduleKind(value) {
  const kind = String(value || "once").trim().toLowerCase();
  return ["once", "interval", "daily"].includes(kind) ? kind : "once";
}

export function isValidTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(value || "UTC") }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function zonedHourMinute(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value),
    minute: Number(parts.find((part) => part.type === "minute")?.value)
  };
}

export function nextDailyRunAt(dailyTime, timeZone = "UTC", nowMs = Date.now()) {
  const match = String(dailyTime || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error("dailyTime must use HH:MM");
  if (!isValidTimeZone(timeZone)) throw new Error("timeZone is invalid");
  const targetHour = Number(match[1]);
  const targetMinute = Number(match[2]);
  const minuteMs = 60_000;
  const start = Math.floor(nowMs / minuteMs) * minuteMs + minuteMs;
  for (let offset = 0; offset <= 49 * 60; offset += 1) {
    const candidateMs = start + (offset * minuteMs);
    const parts = zonedHourMinute(new Date(candidateMs), timeZone);
    if (parts.hour === targetHour && parts.minute === targetMinute) {
      return new Date(candidateMs).toISOString();
    }
  }
  throw new Error("Unable to calculate next daily run");
}

export function calculateNextRunAt(schedule, nowMs = Date.now()) {
  const kind = normalizeScheduleKind(schedule?.kind);
  if (kind === "once") {
    const runAtMs = Date.parse(String(schedule?.runAt || ""));
    if (!Number.isFinite(runAtMs)) throw new Error("runAt is required for a one-time schedule");
    return new Date(Math.max(nowMs + 1000, runAtMs)).toISOString();
  }
  if (kind === "interval") {
    const intervalMinutes = Math.max(1, Math.min(MAX_INTERVAL_MINUTES, Number(schedule?.intervalMinutes || 60)));
    return new Date(nowMs + (intervalMinutes * 60_000)).toISOString();
  }
  return nextDailyRunAt(schedule?.dailyTime, schedule?.timeZone || "UTC", nowMs);
}

export function normalizeAgentRecipeSchedule(input, nowMs = Date.now()) {
  const kind = normalizeScheduleKind(input?.kind);
  const intervalMinutes = Math.max(1, Math.min(MAX_INTERVAL_MINUTES, Number(input?.intervalMinutes || 60)));
  const timeZone = isValidTimeZone(input?.timeZone) ? String(input.timeZone) : "UTC";
  const dailyTime = /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(input?.dailyTime || ""))
    ? String(input.dailyTime)
    : "09:00";
  const schedule = {
    kind,
    runAt: input?.runAt || new Date(nowMs + 60_000).toISOString(),
    intervalMinutes,
    dailyTime,
    timeZone
  };
  return { ...schedule, nextRunAt: calculateNextRunAt(schedule, nowMs) };
}
