CREATE INDEX "deal_vehicle_locks_deal_idx" ON "deal_vehicle_locks" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deals_from_vehicle_idx" ON "deals" USING btree ("from_vehicle_id");--> statement-breakpoint
CREATE INDEX "deals_to_vehicle_idx" ON "deals" USING btree ("to_vehicle_id");