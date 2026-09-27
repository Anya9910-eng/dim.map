CREATE TYPE "public"."billing_mode" AS ENUM('managed', 'self_serve');--> statement-breakpoint
CREATE TYPE "public"."client_mode" AS ENUM('draft', 'auto');--> statement-breakpoint
CREATE TYPE "public"."client_plan" AS ENUM('starter', 'growth');--> statement-breakpoint
CREATE TYPE "public"."draft_status" AS ENUM('pending', 'sent', 'edited', 'discarded', 'send_failed', 'escalated', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."log_final_status" AS ENUM('draft', 'sent', 'edited', 'discarded', 'send_failed');--> statement-breakpoint
CREATE TYPE "public"."log_level" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."log_source" AS ENUM('lemlist', 'n8n', 'claude', 'slack', 'system');--> statement-breakpoint
CREATE TYPE "public"."checklist_type" AS ENUM('client_onboarding', 'internal_setup');--> statement-breakpoint
CREATE TYPE "public"."setup_category" AS ENUM('infrastructure', 'integrations', 'configuration', 'testing');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('draft_created', 'draft_sent', 'draft_edited', 'draft_discarded', 'draft_send_failed', 'draft_escalated', 'draft_skipped', 'webhook_received', 'error');--> statement-breakpoint
CREATE TYPE "public"."epicgram_draft_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"slack_channel" text,
	"slack_workspace_id" text,
	"slack_bot_token" text,
	"mode" "client_mode" DEFAULT 'draft' NOT NULL,
	"plan" "client_plan" DEFAULT 'starter' NOT NULL,
	"lemlist_api_key" text,
	"lemlist_webhook_secret" text,
	"n8n_webhook_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"billing_mode" "billing_mode" DEFAULT 'managed' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"email" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "early_access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"persona_id" integer,
	"name" text NOT NULL,
	"lemlist_campaign_id" text NOT NULL,
	"tone" text,
	"reply_rules" text,
	"region_rules" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"name" text NOT NULL,
	"product_description" text NOT NULL,
	"target_audience" text NOT NULL,
	"tone_of_voice" text NOT NULL,
	"common_objections" text,
	"cta" text NOT NULL,
	"qualification_rules" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"prospect_email" text NOT NULL,
	"lemlist_lead_id" text,
	"prospect_name" text NOT NULL,
	"prospect_company" text,
	"prospect_country" text,
	"prospect_role" text,
	"conversation_snippet" text,
	"reply_text" text NOT NULL,
	"edited_reply_text" text,
	"status" "draft_status" DEFAULT 'pending' NOT NULL,
	"slack_message_ts" text,
	"actioned_at" timestamp with time zone,
	"sweeper_alerted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" integer,
	"campaign_id" integer,
	"draft_id" integer,
	"lead_id" text,
	"level" "log_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"source" "log_source" DEFAULT 'system' NOT NULL,
	"generated_draft" text,
	"final_status" "log_final_status",
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setup_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" "setup_category" NOT NULL,
	"checklist_type" "checklist_type" DEFAULT 'internal_setup' NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "activity_type" NOT NULL,
	"description" text NOT NULL,
	"client_name" text,
	"campaign_name" text,
	"client_id" integer,
	"campaign_id" integer,
	"draft_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_billing" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "epicgram_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"audit_id" text NOT NULL,
	"telegram_account_slot" text,
	"chat_id" text NOT NULL,
	"chat_title" text,
	"messages" text NOT NULL,
	"task" text NOT NULL,
	"reply_text" text NOT NULL,
	"edited_text" text,
	"confidence_score" real,
	"detected_intent" text,
	"suggested_action" text,
	"status" "epicgram_draft_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actioned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "clients_stripe_customer_idx" ON "clients" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_users_email_idx" ON "client_users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "login_codes_email_idx" ON "login_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "early_access_requests_email_idx" ON "early_access_requests" USING btree ("email","created_at");