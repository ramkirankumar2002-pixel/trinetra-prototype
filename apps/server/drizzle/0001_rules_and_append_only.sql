-- Rules that Drizzle cannot express in schema.ts.

-- Trip ranges must not overlap for the same material. btree_gist lets one constraint
-- compare the material with "=" and the range with "overlaps". It is also on Supabase.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "unloading_rules" ADD CONSTRAINT "unloading_rules_no_overlap"
  EXCLUDE USING gist ("material_id" WITH =, int4range("trip_from", "trip_to", '[]') WITH &&)
  WHERE (NOT "is_default");
--> statement-breakpoint

-- The ticket timeline is append-only: a correction adds a new row.
-- TRUNCATE is not blocked, so "db:seed --reset" can still clear a development database.
CREATE FUNCTION "reject_ticket_event_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ticket_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ticket_events_append_only"
  BEFORE UPDATE OR DELETE ON "ticket_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_ticket_event_change"();
