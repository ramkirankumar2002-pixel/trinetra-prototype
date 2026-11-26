-- "Reset demo data" must delete demo tickets with their timelines. This is the only
-- exception to the append-only rule, and it is narrow: DELETE only, only for a ticket
-- tagged is_demo, and only in a transaction that has switched on trinetra.demo_reset.
-- UPDATE is never allowed.
CREATE OR REPLACE FUNCTION "reject_ticket_event_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('trinetra.demo_reset', true) = 'on'
    AND EXISTS (SELECT 1 FROM "tickets" WHERE "id" = OLD."ticket_id" AND "is_demo")
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ticket_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
