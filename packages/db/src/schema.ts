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
import { sql } from "drizzle-orm";
import { AMOE_STATUSES, EMAIL_CATEGORIES, ENTRY_METHODS, FREQUENCIES, type ParsedRules } from "@sweeptrack/core";

export const planEnum = pgEnum("plan", ["free", "pro"]);
export const frequencyEnum = pgEnum("frequency", FREQUENCIES);
export const entryMethodEnum = pgEnum("entry_method", ENTRY_METHODS);
export const amoeStatusEnum = pgEnum("amoe_status", AMOE_STATUSES);
export const emailCategoryEnum = pgEnum("email_category", EMAIL_CATEGORIES);
export const trackedStatusEnum = pgEnum("tracked_status", ["active", "paused", "ended", "hidden"]);
export const winStatusEnum = pgEnum("win_status", ["notified", "claimed", "received", "forfeited", "declined"]);
export const deadlineTypeEnum = pgEnum("amoe_deadline_type", ["postmarked_by", "received_by", "unknown"]);
export const amoeReviewEnum = pgEnum("amoe_review", ["approved", "rejected"]);
export const sourceKindEnum = pgEnum("source_kind", ["rss", "sitemap", "newsletter"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);
export const mailProviderEnum = pgEnum("mail_provider", ["google", "microsoft"]);
export const mailServiceStatusEnum = pgEnum("mail_service_status", [
  "pending_review",
  "queued",
  "printed",
  "mailed",
  "rejected",
]);

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
  isAdmin: boolean("is_admin").default(false).notNull(),
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
    /** Page the user enters on (the sponsor's page when known, else the listing page). */
    url: text("url").notNull(),
    rulesUrl: text("rules_url"),
    title: text("title").notNull(),
    sponsor: text("sponsor"),
    prizeSummary: text("prize_summary"),
    description: text("description"),
    categories: text("categories").array().default([]).notNull(),
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
    /** Admin decision on whether the mail-on-behalf service may be used (docs/SPEC.md §6.1). */
    amoeReview: amoeReviewEnum("amoe_review"),
    amoeReviewNote: text("amoe_review_note"),
    submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Set when a person corrects details; ingestion then stops overwriting fields. */
    humanEditedAt: timestamp("human_edited_at", { withTimezone: true }),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    llmEnrichedAt: timestamp("llm_enriched_at", { withTimezone: true }),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("sweepstakes_ends_at_idx").on(t.endsAt), index("sweepstakes_created_at_idx").on(t.createdAt)],
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
    serviceStatus: mailServiceStatusEnum("service_status"),
    serviceAuthorizedAt: timestamp("service_authorized_at", { withTimezone: true }),
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
    /** forward | google | microsoft */
    source: text("source").default("forward").notNull(),
    /** Provider message id for synced mailboxes, used to skip duplicates. */
    externalId: text("external_id"),
  },
  (t) => [
    index("inbound_user_received_idx").on(t.userId, t.receivedAt),
    uniqueIndex("inbound_user_external_uq").on(t.userId, t.externalId).where(sql`${t.externalId} is not null`),
  ],
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

// ---------- Catalog ingestion ----------

/** A configured catalog source (listing-site feed/sitemap, or the newsletter inbox). */
export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: sourceKindEnum("kind").notNull(),
  url: text("url"),
  enabled: boolean("enabled").default(false).notNull(),
  /** Fetch each listing's own page to find the sponsor link and more details. */
  fetchDetail: boolean("fetch_detail").default(true).notNull(),
  /** Follow through to the sponsor's page + official rules and parse them. */
  followSponsor: boolean("follow_sponsor").default(true).notNull(),
  respectRobots: boolean("respect_robots").default(true).notNull(),
  intervalMinutes: integer("interval_minutes").default(360).notNull(),
  maxItemsPerRun: integer("max_items_per_run").default(40).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  lastItemCount: integer("last_item_count"),
  ...timestamps,
});

/** Items a source has already processed, so reruns only handle new listings. */
export const ingestSeen = pgTable(
  "ingest_seen",
  {
    sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    sweepstakesId: uuid("sweepstakes_id").references(() => sweepstakes.id, { onDelete: "set null" }),
    seenAt: timestamp("seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.itemKey] })],
);

/** Minimal Postgres-backed job queue, drained by the cron tick. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    status: jobStatusEnum("status").default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
    lastError: text("last_error"),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("jobs_pick_idx").on(t.status, t.runAfter)],
);

// ---------- Connected mailboxes ----------

export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: mailProviderEnum("provider").notNull(),
    email: text("email").notNull(),
    /** AES-256-GCM encrypted (see crypto.ts) */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /** active | error | revoked */
    status: text("status").default("active").notNull(),
    lastError: text("last_error"),
    ...timestamps,
  },
  (t) => [uniqueIndex("mail_accounts_uq").on(t.userId, t.provider, t.email)],
);

// ---------- Extension autofill ----------

/** A user's confirmation that `selector` on `domain` holds profile `field`; shared across users once confirmed by several. */
export const fieldMappings = pgTable(
  "field_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    domain: text("domain").notNull(),
    selector: text("selector").notNull(),
    field: text("field").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("field_mappings_uq").on(t.domain, t.selector, t.field, t.userId), index("field_mappings_domain_idx").on(t.domain)],
);
