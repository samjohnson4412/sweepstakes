CREATE TYPE "public"."amoe_review" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mail_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TYPE "public"."mail_service_status" AS ENUM('pending_review', 'queued', 'printed', 'mailed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('rss', 'sitemap', 'newsletter');--> statement-breakpoint
CREATE TABLE "field_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"selector" text NOT NULL,
	"field" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_seen" (
	"source_id" text NOT NULL,
	"item_key" text NOT NULL,
	"sweepstakes_id" uuid,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_seen_source_id_item_key_pk" PRIMARY KEY("source_id","item_key")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "mail_provider" NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"last_sync_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"url" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"fetch_detail" boolean DEFAULT true NOT NULL,
	"follow_sponsor" boolean DEFAULT true NOT NULL,
	"respect_robots" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer DEFAULT 360 NOT NULL,
	"max_items_per_run" integer DEFAULT 40 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"last_item_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "amoe_entries" ADD COLUMN "service_status" "mail_service_status";--> statement-breakpoint
ALTER TABLE "amoe_entries" ADD COLUMN "service_authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "source" text DEFAULT 'forward' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "categories" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "amoe_review" "amoe_review";--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "amoe_review_note" text;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "human_edited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "last_crawled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sweepstakes" ADD COLUMN "llm_enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_seen" ADD CONSTRAINT "ingest_seen_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_seen" ADD CONSTRAINT "ingest_seen_sweepstakes_id_sweepstakes_id_fk" FOREIGN KEY ("sweepstakes_id") REFERENCES "public"."sweepstakes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_mappings_uq" ON "field_mappings" USING btree ("domain","selector","field","user_id");--> statement-breakpoint
CREATE INDEX "field_mappings_domain_idx" ON "field_mappings" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_accounts_uq" ON "mail_accounts" USING btree ("user_id","provider","email");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_user_external_uq" ON "inbound_messages" USING btree ("user_id","external_id") WHERE "inbound_messages"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "sweepstakes_created_at_idx" ON "sweepstakes" USING btree ("created_at");