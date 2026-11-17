// The field-day clock. Every action costs field time; a scenario grants a fixed number of days.

export interface Clock {
  /** Field day, from 1. */
  day: number;
  /** Minutes used in the current day. */
  minutes: number;
}

export interface ClockRules {
  field_days: number;
  minutes_per_day: number;
}

export const DAY_START_MINUTES = 8 * 60; // field days start at 08:00

export type DayState = "working" | "day_over" | "campaign_over";

export function spend(clock: Clock, minutes: number, rules: ClockRules): DayState {
  clock.minutes = Math.min(clock.minutes + minutes, rules.minutes_per_day);
  return dayState(clock, rules);
}

export function dayState(clock: Clock, rules: ClockRules): DayState {
  if (clock.minutes < rules.minutes_per_day) return "working";
  return clock.day >= rules.field_days ? "campaign_over" : "day_over";
}

export function nextDay(clock: Clock, rules: ClockRules): boolean {
  if (dayState(clock, rules) !== "day_over") return false;
  clock.day += 1;
  clock.minutes = 0;
  return true;
}

export function timeOfDay(clock: Clock): string {
  const total = DAY_START_MINUTES + Math.floor(clock.minutes);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function remaining(clock: Clock, rules: ClockRules): string {
  const left = Math.max(rules.minutes_per_day - Math.floor(clock.minutes), 0);
  return `${Math.floor(left / 60)} h ${String(left % 60).padStart(2, "0")} min`;
}
