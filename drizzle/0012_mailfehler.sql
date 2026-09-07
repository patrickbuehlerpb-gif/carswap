-- Diese Migration muss auf zwei verschiedene Ausgangslagen passen.
--
-- Eine frühere Fassung von 0012 hat `mail_failures` bereits angelegt, ohne die
-- Spalte `systemic` — und sie ist in der Produktionsdatenbank gelaufen. Danach
-- wurde die Datei neu erzeugt, um die Spalte zu ergänzen; damit bekam sie einen
-- neuen Zeitstempel im Journal, und der Migrator hielt sie für unerledigt. Er
-- versuchte also ein zweites `CREATE TABLE` auf eine Tabelle, die es schon gab,
-- und brach mit 42P07 ab. Jeder Deploy seither ist daran gescheitert.
--
-- Deshalb von Hand geschrieben statt erzeugt, und in zwei Schritten: Die leere
-- Datenbank bekommt Tabelle und Spalte, die bestehende nur die fehlende Spalte
-- nachgereicht. Beide Wege enden bei derselben Form.
--
-- Wer hier eingreift, muss dasselbe bedenken: Eine Migration, die irgendwo
-- schon gelaufen ist, darf in ihrer Wirkung nie mehr verändert werden — nur so
-- ergänzt, dass sie ein zweites Mal folgenlos durchläuft.
CREATE TABLE IF NOT EXISTS "mail_failures" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"domain" text NOT NULL,
	"subject" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_failures" ADD COLUMN IF NOT EXISTS "systemic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mail_failures_created_at_idx" ON "mail_failures" USING btree ("created_at");
