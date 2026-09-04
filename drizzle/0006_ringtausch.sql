CREATE TABLE "ring_legs" (
	"id" text PRIMARY KEY NOT NULL,
	"ring_id" text NOT NULL,
	"position" smallint NOT NULL,
	"user_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"receiver_id" text NOT NULL,
	"cash" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ring_swaps" (
	"id" text PRIMARY KEY NOT NULL,
	"initiator_id" text NOT NULL,
	"status" text DEFAULT 'vorschlag' NOT NULL,
	"accepted_at" timestamp with time zone,
	"escrow_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_messages" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_vehicle_locks" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_messages" ADD COLUMN "ring_id" text;--> statement-breakpoint
ALTER TABLE "deal_vehicle_locks" ADD COLUMN "ring_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "ring_id" text;--> statement-breakpoint
ALTER TABLE "ring_legs" ADD CONSTRAINT "ring_legs_ring_id_ring_swaps_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."ring_swaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ring_legs" ADD CONSTRAINT "ring_legs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ring_legs" ADD CONSTRAINT "ring_legs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ring_legs" ADD CONSTRAINT "ring_legs_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ring_swaps" ADD CONSTRAINT "ring_swaps_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ring_legs_position_key" ON "ring_legs" USING btree ("ring_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "ring_legs_user_key" ON "ring_legs" USING btree ("ring_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ring_legs_vehicle_key" ON "ring_legs" USING btree ("ring_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "ring_legs_user_idx" ON "ring_legs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ring_legs_vehicle_idx" ON "ring_legs" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "ring_swaps_status_idx" ON "ring_swaps" USING btree ("status");--> statement-breakpoint
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_ring_id_ring_swaps_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."ring_swaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_vehicle_locks" ADD CONSTRAINT "deal_vehicle_locks_ring_id_ring_swaps_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."ring_swaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ring_id_ring_swaps_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."ring_swaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_messages_ring_idx" ON "deal_messages" USING btree ("ring_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_vehicle_locks_ring_idx" ON "deal_vehicle_locks" USING btree ("ring_id");--> statement-breakpoint
CREATE INDEX "payments_ring_idx" ON "payments" USING btree ("ring_id");--> statement-breakpoint
ALTER TABLE "deal_messages" ADD CONSTRAINT "deal_messages_owner_check" CHECK (num_nonnulls("deal_messages"."deal_id", "deal_messages"."ring_id") = 1);--> statement-breakpoint
ALTER TABLE "deal_vehicle_locks" ADD CONSTRAINT "deal_vehicle_locks_owner_check" CHECK (num_nonnulls("deal_vehicle_locks"."deal_id", "deal_vehicle_locks"."ring_id") = 1);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_check" CHECK (num_nonnulls("payments"."deal_id", "payments"."ring_id") = 1);