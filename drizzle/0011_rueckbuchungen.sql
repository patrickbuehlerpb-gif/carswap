ALTER TABLE "payments" ADD COLUMN "disputed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "dispute_status" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "dispute_amount_minor" integer;