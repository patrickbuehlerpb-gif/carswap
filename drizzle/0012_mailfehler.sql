CREATE TABLE "mail_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text NOT NULL,
	"subject" text NOT NULL,
	"reason" text NOT NULL,
	"systemic" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_failures_created_at_idx" ON "mail_failures" USING btree ("created_at");