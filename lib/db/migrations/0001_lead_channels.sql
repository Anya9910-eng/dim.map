CREATE TYPE "public"."lead_channel" AS ENUM('lemlist', 'meta', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."lead_qualification" AS ENUM('hot', 'warm', 'cold', 'unqualified');--> statement-breakpoint
ALTER TYPE "public"."log_source" ADD VALUE 'meta';--> statement-breakpoint
ALTER TYPE "public"."log_source" ADD VALUE 'whatsapp';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "whatsapp_phone_number_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "whatsapp_access_token" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "channel" "lead_channel" DEFAULT 'lemlist' NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "channel" "lead_channel" DEFAULT 'lemlist' NOT NULL;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "prospect_phone" text;--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "qualification" "lead_qualification";--> statement-breakpoint
ALTER TABLE "drafts" ADD COLUMN "qualification_reason" text;