CREATE TYPE "public"."ticket_load" AS ENUM('LOADED', 'EMPTY');--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "load" "ticket_load" DEFAULT 'LOADED' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "no_invoice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_no_invoice_has_none" CHECK (not "tickets"."no_invoice" or ("tickets"."invoice_no" is null and "tickets"."invoice_weight_kg" is null));