CREATE TYPE "public"."amoe_status" AS ENUM('planned', 'prepared', 'mailed', 'confirmed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."amoe_deadline_type" AS ENUM('postmarked_by', 'received_by', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."email_category" AS ENUM('win_notice', 'confirmation', 'newsletter', 'promo', 'other');--> statement-breakpoint
CREATE TYPE "public"."entry_method" AS ENUM('online', 'amoe', 'social', 'text', 'instant_win');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('once', 'daily', 'daily_24h', 'weekly', 'monthly', 'unlimited', 'per_purchase');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro');--> statement-breakpoint
CREATE TYPE "public"."tracked_status" AS ENUM('active', 'paused', 'ended', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."win_status" AS ENUM('notified', 'claimed', 'received', 'forfeited', 'declined');--> statement-breakpoint
CREATE TABLE "amoe_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sweepstakes_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"status" "amoe_status" DEFAULT 'planned' NOT NULL,
	"deadline" date,
	"deadline_type" "amoe_deadline_type" DEFAULT 'unknown' NOT NULL,
	"mail_by" date,
	"postage_cents" integer DEFAULT 0 NOT NULL,
	"mailed_at" timestamp with time zone,
	"fulfilled_by" text DEFAULT 'self' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "entrant_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"address1" text,
	"address2" text,
	"city" text,
	"state" text,
	"zip" text,
	"country" text DEFAULT 'US',
	"birth_date" date,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sweepstakes_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"method" "entry_method" DEFAULT 'online' NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"category" "email_category" NOT NULL,
	"confidence" real NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scam_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sweepstakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_url" text NOT NULL,
	"url" text NOT NULL,
	"rules_url" text,
	"title" text NOT NULL,
	"sponsor" text,
	"prize_summary" text,
	"total_arv_cents" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"frequency" "frequency" DEFAULT 'daily' NOT NULL,
	"sponsor_tz" text DEFAULT 'America/New_York' NOT NULL,
	"min_age" integer,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"excluded_states" text[] DEFAULT '{}' NOT NULL,
	"amoe" jsonb,
	"parse_confidence" jsonb,
	"submitted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sweepstakes_canonical_url_unique" UNIQUE("canonical_url")
);
--> statement-breakpoint
CREATE TABLE "sweepstakes_sources" (
	"sweepstakes_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"external_url" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sweepstakes_sources_sweepstakes_id_source_id_pk" PRIMARY KEY("sweepstakes_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "tracked_profiles" (
	"tracked_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	CONSTRAINT "tracked_profiles_tracked_id_profile_id_pk" PRIMARY KEY("tracked_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "tracked_sweepstakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sweepstakes_id" uuid NOT NULL,
	"status" "tracked_status" DEFAULT 'active' NOT NULL,
	"frequency_override" "frequency",
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"inbound_token" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_inbound_token_unique" UNIQUE("inbound_token")
);
--> statement-breakpoint
CREATE TABLE "wins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sweepstakes_id" uuid,
	"profile_id" uuid,
	"inbound_message_id" uuid,
	"prize" text NOT NULL,
	"sponsor" text,
	"arv_cents" integer DEFAULT 0 NOT NULL,
	"status" "win_status" DEFAULT 'notified' NOT NULL,
	"notified_at" date,
	"claim_deadline" date,
	"affidavit_submitted" boolean DEFAULT false NOT NULL,
	"w9_submitted" boolean DEFAULT false NOT NULL,
	"received_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amoe_entries" ADD CONSTRAINT "amoe_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amoe_entries" ADD CONSTRAINT "amoe_entries_sweepstakes_id_sweepstakes_id_fk" FOREIGN KEY ("sweepstakes_id") REFERENCES "public"."sweepstakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amoe_entries" ADD CONSTRAINT "amoe_entries_profile_id_entrant_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."entrant_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrant_profiles" ADD CONSTRAINT "entrant_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_sweepstakes_id_sweepstakes_id_fk" FOREIGN KEY ("sweepstakes_id") REFERENCES "public"."sweepstakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_profile_id_entrant_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."entrant_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD CONSTRAINT "sweepstakes_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sweepstakes_sources" ADD CONSTRAINT "sweepstakes_sources_sweepstakes_id_sweepstakes_id_fk" FOREIGN KEY ("sweepstakes_id") REFERENCES "public"."sweepstakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_profiles" ADD CONSTRAINT "tracked_profiles_tracked_id_tracked_sweepstakes_id_fk" FOREIGN KEY ("tracked_id") REFERENCES "public"."tracked_sweepstakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_profiles" ADD CONSTRAINT "tracked_profiles_profile_id_entrant_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."entrant_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sweepstakes" ADD CONSTRAINT "tracked_sweepstakes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_sweepstakes" ADD CONSTRAINT "tracked_sweepstakes_sweepstakes_id_sweepstakes_id_fk" FOREIGN KEY ("sweepstakes_id") REFERENCES "public"."sweepstakes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins" ADD CONSTRAINT "wins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins" ADD CONSTRAINT "wins_sweepstakes_id_sweepstakes_id_fk" FOREIGN KEY ("sweepstakes_id") REFERENCES "public"."sweepstakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins" ADD CONSTRAINT "wins_profile_id_entrant_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."entrant_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wins" ADD CONSTRAINT "wins_inbound_message_id_inbound_messages_id_fk" FOREIGN KEY ("inbound_message_id") REFERENCES "public"."inbound_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amoe_user_mailby_idx" ON "amoe_entries" USING btree ("user_id","mail_by");--> statement-breakpoint
CREATE INDEX "entrant_profiles_user_idx" ON "entrant_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entries_lookup_idx" ON "entries" USING btree ("user_id","sweepstakes_id","profile_id","entered_at");--> statement-breakpoint
CREATE INDEX "inbound_user_received_idx" ON "inbound_messages" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "sweepstakes_ends_at_idx" ON "sweepstakes" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_user_sweeps_uq" ON "tracked_sweepstakes" USING btree ("user_id","sweepstakes_id");--> statement-breakpoint
CREATE INDEX "wins_user_idx" ON "wins" USING btree ("user_id");