import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { AMOE_STATUSES, EMAIL_CATEGORIES, ENTRY_METHODS, FREQUENCIES, type ParsedRules } from "@sweeptrack/core";

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const frequencyEnum = pgEnum("frequency", FREQUENCIES);
export const entryMethodEnum = pgEnum("entry_method", ENTRY_METHODS);
export const amoeStatusEnum = pgEnum("amoe_status", AMOE_STATUSES);
export const emailCategoryEnum = pgEnum("email_category", EMAIL_CATEGORIES);
export const trackedStatusEnum = pgEnum("tracked_status", ["active", "paused", "ended", "hidden"]);
export const winStatusEnum = pgEnum("win_status", ["notified", "claimed", "received", "forfeited", "declined"]);
export const deadlineTypeEnum = pgEnum("amoe_deadline_type", ["postmarked_by", "received_by", "unknown"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
};

// ---------- Accounts & auth ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  plan: planEnum("plan").default("free").notNull(),
  /** Local part token for the user's forwarding address: u-<token>@INBOUND_EMAIL_DOMAIN */
  inboundToken: text("inbound_token").notNull().unique(),
  timezone: text("timezone").default("America/New_York").notNull(),
  ...timestamps,
});

export const sessions = pgTable("sessions", {
  /** sha256 of the session cookie value */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** sha256 of the bearer token; the raw token is shown once */
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  ...timestamps,
});

export const entrantProfiles = pgTable(
  "entrant_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    address1: text("address1"),
    address2: text("address2"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    country: text("country").default("US"),
    birthDate: date("birth_date"),
    isDefault: boolean("is_default").default(false).notNull(),
    ...timestamps,
  },
  (t) => [index("entrant_profiles_user_idx").on(t.userId)],
);

// ---------- Global catalog ----------

export type AmoeDetails = ParsedRules["amoe"];

export const sweepstakes = pgTable(
  "sweepstakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalUrl: text("canonical_url").notNull().unique(),
    url: text("url").notNull(),
    rulesUrl: text("rules_url"),
    title: text("title").notNull(),
    sponsor: text("sponsor"),
    prizeSummary: text("prize_summary"),
    totalArvCents: integer("total_arv_cents"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    frequency: frequencyEnum("frequency").default("daily").notNull(),
    sponsorTz: text("sponsor_tz").default("America/New_York").notNull(),
    minAge: integer("min_age"),
    countries: text("countries").array().default([]).notNull(),
    excludedStates: text("excluded_states").array().default([]).notNull(),
    amoe: jsonb("amoe").$type<AmoeDetails>(),
    parseConfidence: jsonb("parse_confidence").$type<ParsedRules["confidence"]>(),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sweepstakes_ends_at_idx").on(t.endsAt)],
);

/** Where a catalog item was seen (crawler, listing-site adapter, newsletter, user). */
export const sweepstakesSources = pgTable(
  "sweepstakes_sources",
  {
    sweepstakesId: uuid("sweepstakes_id").notNull().references(() => sweepstakes.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    externalUrl: text("external_url"),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.sweepstakesId, t.sourceId] })],
);

// ---------- Per-account tracking ----------

export const trackedSweepstakes = pgTable(
  "tracked_sweepstakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sweepstakesId: uuid("sweepstakes_id").notNull().references(() => sweepstakes.id, { onDelete: "cascade" }),
    status: trackedStatusEnum("status").default("active").notNull(),
    /** Overrides the catalog frequency when the user knows better. */
    frequencyOverride: frequencyEnum("frequency_override"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [uniqueIndex("tracked_user_sweeps_uq").on(t.userId, t.sweepstakesId)],
);

/** Which entrant profiles enter a tracked sweepstakes. */
export const trackedProfiles = pgTable(
  "tracked_profiles",
  {
    trackedId: uuid("tracked_id").notNull().references(() => trackedSweepstakes.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => entrantProfiles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.trackedId, t.profileId] })],
);

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sweepstakesId: uuid("sweepstakes_id").notNull().references(() => sweepstakes.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => entrantProfiles.id, { onDelete: "cascade" }),
    method: entryMethodEnum("method").default("online").notNull(),
    /** web | extension | email */
    source: text("source").default("web").notNull(),
    enteredAt: timestamp("entered_at", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
  },
  (t) => [index("entries_lookup_idx").on(t.userId, t.sweepstakesId, t.profileId, t.enteredAt)],
);

export const amoeEntries = pgTable(
  "amoe_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sweepstakesId: uuid("sweepstakes_id").notNull().references(() => sweepstakes.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").notNull().references(() => entrantProfiles.id, { onDelete: "cascade" }),
    status: amoeStatusEnum("status").default("planned").notNull(),
    deadline: date("deadline"),
    deadlineType: deadlineTypeEnum("deadline_type").default("unknown").notNull(),
    mailBy: date("mail_by"),
    postageCents: integer("postage_cents").default(0).notNull(),
    mailedAt: timestamp("mailed_at", { withTimezone: true }),
    /** self | service — "service" is the gated mail-on-behalf feature (see docs/SPEC.md §6.1) */
    fulfilledBy: text("fulfilled_by").default("self").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("amoe_user_mailby_idx").on(t.userId, t.mailBy)],
);

export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    category: emailCategoryEnum("category").notNull(),
    confidence: real("confidence").notNull(),
    signals: jsonb("signals").$type<string[]>().default([]).notNull(),
    scamSignals: jsonb("scam_signals").$type<string[]>().default([]).notNull(),
    links: jsonb("links").$type<string[]>().default([]).notNull(),
    dismissed: boolean("dismissed").default(false).notNull(),
  },
  (t) => [index("inbound_user_received_idx").on(t.userId, t.receivedAt)],
);

export const wins = pgTable(
  "wins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sweepstakesId: uuid("sweepstakes_id").references(() => sweepstakes.id, { onDelete: "set null" }),
    profileId: uuid("profile_id").references(() => entrantProfiles.id, { onDelete: "set null" }),
    inboundMessageId: uuid("inbound_message_id").references(() => inboundMessages.id, { onDelete: "set null" }),
    prize: text("prize").notNull(),
    sponsor: text("sponsor"),
    arvCents: integer("arv_cents").default(0).notNull(),
    status: winStatusEnum("status").default("notified").notNull(),
    notifiedAt: date("notified_at"),
    claimDeadline: date("claim_deadline"),
    affidavitSubmitted: boolean("affidavit_submitted").default(false).notNull(),
    w9Submitted: boolean("w9_submitted").default(false).notNull(),
    receivedAt: date("received_at"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("wins_user_idx").on(t.userId)],
);
