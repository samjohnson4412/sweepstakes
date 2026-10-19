import type { AmoeDeadlineType, EntrantProfileData } from "./types";
import { subtractBusinessDays } from "./time";

/** Default USPS First-Class transit buffer, in business days. */
export const DEFAULT_TRANSIT_DAYS = 5;

/**
 * Latest date the entry should go in the mail.
 * - postmarked_by: the deadline itself (minus one day of safety, since late-day drop-offs may postmark next day)
 * - received_by / unknown: deadline minus transit buffer
 */
export function mailByDate(
  deadline: Date,
  deadlineType: AmoeDeadlineType,
  transitBusinessDays = DEFAULT_TRANSIT_DAYS,
): Date {
  if (deadlineType === "postmarked_by") return subtractBusinessDays(deadline, 1);
  return subtractBusinessDays(deadline, transitBusinessDays);
}

/** Text to hand-print on a 3x5 card / letter, per common AMOE requirements. */
export function amoeCardLines(profile: EntrantProfileData, extra?: { sweepstakesTitle?: string; includeAge?: boolean; asOf?: Date }): string[] {
  const lines = [`${profile.firstName} ${profile.lastName}`];
  if (profile.address1) lines.push(profile.address1);
  if (profile.address2) lines.push(profile.address2);
  const cityLine = [profile.city, [profile.state, profile.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (profile.phone) lines.push(profile.phone);
  lines.push(profile.email);
  if (extra?.includeAge && profile.birthDate) {
    lines.push(`Age: ${ageOn(profile.birthDate, extra.asOf ?? new Date())}`);
  }
  if (extra?.sweepstakesTitle) lines.push(extra.sweepstakesTitle);
  return lines;
}

export function ageOn(birthDate: string, on: Date): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = on.getUTCFullYear() - y;
  const beforeBirthday = on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

/** Postage + supplies cost for one AMOE mailing, in cents. */
export function amoeCostCents(opts: { stampCents: number; stamps?: number; envelopeCents?: number; sase?: boolean }): number {
  const stamps = (opts.stamps ?? 1) + (opts.sase ? 1 : 0);
  const envelopes = 1 + (opts.sase ? 1 : 0);
  return stamps * opts.stampCents + envelopes * (opts.envelopeCents ?? 0);
}
