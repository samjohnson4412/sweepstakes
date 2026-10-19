export const FREQUENCIES = [
  "once",
  "daily",
  "daily_24h",
  "weekly",
  "monthly",
  "unlimited",
  "per_purchase",
] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const ENTRY_METHODS = ["online", "amoe", "social", "text", "instant_win"] as const;
export type EntryMethod = (typeof ENTRY_METHODS)[number];

export const AMOE_STATUSES = ["planned", "prepared", "mailed", "confirmed", "skipped"] as const;
export type AmoeStatus = (typeof AMOE_STATUSES)[number];

export type AmoeDeadlineType = "postmarked_by" | "received_by" | "unknown";
export type TriState = "yes" | "no" | "unknown";

export const EMAIL_CATEGORIES = ["win_notice", "confirmation", "newsletter", "promo", "other"] as const;
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];

/** Profile fields the extension can autofill. */
export const PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "fullName",
  "email",
  "phone",
  "address1",
  "address2",
  "city",
  "state",
  "zip",
  "country",
  "birthDate",
  "birthMonth",
  "birthDay",
  "birthYear",
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export interface EntrantProfileData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  /** ISO date, YYYY-MM-DD */
  birthDate?: string | null;
}
