import type { Frequency } from "./types";
import { addDays, zonedMidnight, zonedParts } from "./time";

export const DEFAULT_SPONSOR_TZ = "America/New_York";

export interface EligibilityInput {
  frequency: Frequency;
  lastEntryAt: Date | null;
  /** Timezone the official rules use for "per day" limits. */
  sponsorTz?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

/**
 * When the next entry is allowed. Returns `null` if no further entry is possible
 * (single-entry already used, or the promotion has ended).
 */
export function nextEligibleAt(input: EligibilityInput): Date | null {
  const { frequency, lastEntryAt, startsAt, endsAt } = input;
  const tz = input.sponsorTz ?? DEFAULT_SPONSOR_TZ;

  let next: Date | null;
  if (!lastEntryAt) {
    next = new Date(0);
  } else {
    switch (frequency) {
      case "once":
        next = null;
        break;
      case "daily_24h":
        next = addDays(lastEntryAt, 1);
        break;
      case "daily": {
        const p = zonedParts(lastEntryAt, tz);
        next = zonedMidnight(p.year, p.month, p.day + 1, tz);
        break;
      }
      case "weekly": {
        // Calendar week in sponsor tz, starting Sunday.
        const p = zonedParts(lastEntryAt, tz);
        const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
        next = zonedMidnight(p.year, p.month, p.day + (7 - dow), tz);
        break;
      }
      case "monthly": {
        const p = zonedParts(lastEntryAt, tz);
        next = zonedMidnight(p.year, p.month + 1, 1, tz);
        break;
      }
      case "unlimited":
      case "per_purchase":
        next = lastEntryAt;
        break;
    }
  }

  if (next && startsAt && next < startsAt) next = startsAt;
  if (next && endsAt && next > endsAt) return null;
  return next;
}

/** Whether a tracked sweepstakes should appear on the "due now" list. */
export function isDue(input: EligibilityInput, now: Date = new Date()): boolean {
  if (input.frequency === "unlimited" || input.frequency === "per_purchase") return false;
  if (input.endsAt && now > input.endsAt) return false;
  if (input.startsAt && now < input.startsAt) return false;
  const next = nextEligibleAt(input);
  return next !== null && next <= now;
}

export function daysUntil(target: Date, now: Date = new Date()): number {
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}
