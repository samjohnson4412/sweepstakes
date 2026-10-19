/** Minimal timezone helpers built on Intl so `core` stays dependency-free. */

const DAY_MS = 86_400_000;

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const get = (type: string) => Number(fmt.formatToParts(date).find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** UTC instant of local midnight for a calendar date in `timeZone`. Month is 1-12; overflow is normalized. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let result = guess - tzOffsetMs(new Date(guess), timeZone);
  // Re-check once in case the guess and the result straddle a DST change.
  result = guess - tzOffsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** Local calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Subtract business days (Mon–Fri), ignoring holidays. */
export function subtractBusinessDays(date: Date, days: number): Date {
  let d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d = addDays(d, -1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d;
}
