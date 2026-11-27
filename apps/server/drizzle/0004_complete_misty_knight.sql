CREATE TYPE "public"."capture_source" AS ENUM('camera', 'fallback');--> statement-breakpoint
CREATE TYPE "public"."plate_match_result" AS ENUM('MATCH', 'CLOSE', 'NO_MATCH', 'NOT_READ', 'MANUAL');--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "match_result" "plate_match_result";--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "plate_confidence" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "capture_source" "capture_source";--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "manual_plate" text;