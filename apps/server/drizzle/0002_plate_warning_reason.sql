CREATE TYPE "public"."plate_warning_reason" AS ENUM('BLOCKED_HISTORY', 'FRONT_BACK_MISMATCH');--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "plate_warning_reason" "plate_warning_reason";--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_plate_warning_reason" CHECK (("approvals"."kind" = 'PLATE_WARNING') = ("approvals"."plate_warning_reason" is not null));