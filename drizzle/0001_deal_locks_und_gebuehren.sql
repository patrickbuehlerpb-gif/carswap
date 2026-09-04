CREATE TABLE "deal_vehicle_locks" (
	"vehicle_id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_vehicle_locks" ADD CONSTRAINT "deal_vehicle_locks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_vehicle_locks" ADD CONSTRAINT "deal_vehicle_locks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_intent_key" ON "payments" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
-- Bestandsdaten: Tausche, die beim Ausrollen bereits verbindlich zugesagt
-- sind, bekommen ihre Fahrzeugsperre nachgetragen. Ohne das gälte die Regel
-- „ein Fahrzeug nur in einem verbindlichen Tausch“ für den Altbestand nicht.
INSERT INTO "deal_vehicle_locks" ("vehicle_id", "deal_id")
SELECT "vehicle_id", MIN("deal_id")
FROM (
  SELECT "from_vehicle_id" AS "vehicle_id", "id" AS "deal_id" FROM "deals"
   WHERE "status" IN ('angenommen', 'treuhand')
  UNION ALL
  SELECT "to_vehicle_id", "id" FROM "deals"
   WHERE "status" IN ('angenommen', 'treuhand')
) AS "gebunden"
GROUP BY "vehicle_id"
ON CONFLICT ("vehicle_id") DO NOTHING;
--> statement-breakpoint
-- Bereits reservierte Zahlungen haben kein authorized_at. Ohne Wert gälten
-- sie als nie verfallend; der letzte Änderungszeitpunkt ist die beste
-- verfügbare Näherung.
UPDATE "payments" SET "authorized_at" = "updated_at"
 WHERE "status" = 'autorisiert' AND "authorized_at" IS NULL;
