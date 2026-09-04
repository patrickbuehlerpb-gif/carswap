CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"offer_cash" integer,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" text PRIMARY KEY NOT NULL,
	"from_vehicle_id" text NOT NULL,
	"to_vehicle_id" text NOT NULL,
	"initiator_id" text NOT NULL,
	"counterparty_id" text NOT NULL,
	"cash_delta" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'vorschlag' NOT NULL,
	"accepted_at" timestamp with time zone,
	"escrow_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"initiator_confirmed" boolean DEFAULT false NOT NULL,
	"counterparty_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text PRIMARY KEY NOT NULL,
	"vehicle_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"wish_makes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wish_bodies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wish_fuels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wish_min_year" integer,
	"wish_max_mileage_km" integer,
	"wish_max_cash_out" integer,
	"wish_notes" text,
	"ask_premium" integer DEFAULT 0 NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'aktiv' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"payer_id" text NOT NULL,
	"payee_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'chf' NOT NULL,
	"status" text DEFAULT 'erstellt' NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_transfer_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"author_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"stars" real NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"canton" text DEFAULT '' NOT NULL,
	"phone" text,
	"avatar_color" text DEFAULT '#c2ee3a' NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"swaps_completed" integer DEFAULT 0 NOT NULL,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"stripe_account_id" text,
	"stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"trim" text DEFAULT '' NOT NULL,
	"first_registration" text NOT NULL,
	"mileage_km" integer NOT NULL,
	"fuel" text NOT NULL,
	"body" text NOT NULL,
	"drivetrain" text NOT NULL,
	"power_ps" integer NOT NULL,
	"list_price_new" integer NOT NULL,
	"condition" text NOT NULL,
	"color" text DEFAULT '' NOT NULL,
	"range_km" integer,
	"battery_soh" smallint,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"defects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"service_history" text NOT NULL,
	"previous_owners" smallint DEFAULT 1 NOT NULL,
	"accident_free" boolean DEFAULT true NOT NULL,
	"mfk_until" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"user_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_user_id_listing_id_pk" PRIMARY KEY("user_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_from_vehicle_id_vehicles_id_fk" FOREIGN KEY ("from_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_to_vehicle_id_vehicles_id_fk" FOREIGN KEY ("to_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_counterparty_id_users_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payee_id_users_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_users_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "deal_messages_deal_idx" ON "deal_messages" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deals_initiator_idx" ON "deals" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "deals_counterparty_idx" ON "deals" USING btree ("counterparty_id");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_vehicle_key" ON "listings" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "listings_status_idx" ON "listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "listings_owner_idx" ON "listings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "payments_deal_idx" ON "payments" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_session_key" ON "payments" USING btree ("stripe_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_deal_author_key" ON "reviews" USING btree ("deal_id","author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "vehicles_owner_idx" ON "vehicles" USING btree ("owner_id");