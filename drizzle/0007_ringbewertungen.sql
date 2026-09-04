ALTER TABLE "reviews" ALTER COLUMN "deal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "ring_id" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ring_id_ring_swaps_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."ring_swaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_ring_author_key" ON "reviews" USING btree ("ring_id","author_id","subject_id");--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_owner_check" CHECK (num_nonnulls("reviews"."deal_id", "reviews"."ring_id") = 1);