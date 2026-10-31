import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateNextRunAt,
  isValidTimeZone,
  nextDailyRunAt,
  normalizeAgentRecipeSchedule
} from "../src/agent-recipe-schedule.js";

test("calculates bounded interval schedules", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  assert.equal(calculateNextRunAt({ kind: "interval", intervalMinutes: 15 }, now), "2026-08-24T12:15:00.000Z");
  assert.equal(normalizeAgentRecipeSchedule({ kind: "interval", intervalMinutes: 0 }, now).intervalMinutes, 60);
});

test("calculates daily schedules in an IANA time zone", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  assert.equal(isValidTimeZone("America/New_York"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(nextDailyRunAt("09:30", "America/New_York", now), "2026-08-24T13:30:00.000Z");
});

test("normalizes invalid daily fields conservatively", () => {
  const now = Date.parse("2026-08-24T12:00:00.000Z");
  const schedule = normalizeAgentRecipeSchedule({ kind: "daily", dailyTime: "bad", timeZone: "bad" }, now);
  assert.equal(schedule.dailyTime, "09:00");
  assert.equal(schedule.timeZone, "UTC");
  assert.equal(schedule.nextRunAt, "2026-08-25T09:00:00.000Z");
});
