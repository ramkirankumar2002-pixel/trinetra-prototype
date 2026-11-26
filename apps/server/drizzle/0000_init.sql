CREATE TYPE "public"."approval_kind" AS ENUM('STORE_TYPE2', 'SUPERVISOR', 'HOLD', 'MISMATCH', 'DRIVER_HELP', 'PLATE_WARNING');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."hold_weight_choice" AS ENUM('MEASURED_NET', 'INVOICE_WEIGHT');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'hi');--> statement-breakpoint
CREATE TYPE "public"."photo_kind" AS ENUM('FRONT_PLATE', 'BACK_PLATE', 'INVOICE', 'SUPERVISOR', 'STORE');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('STARTED', 'MISMATCH_PENDING', 'STORE_PENDING', 'READY_FOR_UNLOAD', 'SUPERVISOR_PENDING', 'READY_FOR_SECOND', 'HOLD_PENDING', 'COMPLETED', 'REJECTED', 'BLOCKED', 'ABANDONED');--> statement-breakpoint
CREATE TYPE "public"."ticket_type" AS ENUM('TYPE_1', 'TYPE_2', 'TYPE_3');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('KIOSK', 'SUPERVISOR', 'STORE');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "approvals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticket_id" integer,
	"kind" "approval_kind" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"decided_by" integer,
	"reason" text,
	"chosen_weight" "hold_weight_choice",
	"chosen_material_id" integer,
	"photo_id" uuid,
	"plate_read" text,
	"plate_match" boolean,
	"gps" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "approvals_ticket_required" CHECK ("approvals"."ticket_id" is not null or "approvals"."kind" = 'DRIVER_HELP')
);
--> statement-breakpoint
CREATE TABLE "chainages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chainages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"location" text NOT NULL,
	"supervisor_id" integer NOT NULL,
	CONSTRAINT "chainages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "materials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"type" "ticket_type" NOT NULL,
	"type2_above_kg" integer,
	"aliases_en" text[] DEFAULT '{}' NOT NULL,
	"aliases_hi" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "materials_name_unique" UNIQUE("name"),
	CONSTRAINT "materials_base_type" CHECK ("materials"."type" <> 'TYPE_2'),
	CONSTRAINT "materials_weight_rule" CHECK ("materials"."type2_above_kg" is null or ("materials"."type2_above_kg" > 0 and "materials"."type" = 'TYPE_3'))
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" integer,
	"kind" "photo_kind" NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "suppliers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "suppliers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ticket_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"ticket_id" integer NOT NULL,
	"type" text NOT NULL,
	"actor" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_actor_format" CHECK ("ticket_events"."actor" ~ '^(system|device:.+|user:[0-9]+)$')
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tickets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticket_no" text NOT NULL,
	"plate" text NOT NULL,
	"status" "ticket_status" DEFAULT 'STARTED' NOT NULL,
	"language" "language" NOT NULL,
	"material_id" integer,
	"type" "ticket_type",
	"supplier" text,
	"transporter" text,
	"invoice_no" text,
	"invoice_material" text,
	"invoice_date" date,
	"invoice_weight_kg" integer,
	"held_weight_kg" integer,
	"first_weight_kg" integer,
	"second_weight_kg" integer,
	"net_kg" integer,
	"variance_pct" numeric(12, 3),
	"trip_no" integer,
	"unloading_point_id" integer,
	"supervisor_id" integer,
	"driver_name" text,
	"driver_phone" text,
	"mismatch_attempts" integer DEFAULT 0 NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_weight_at" timestamp with time zone,
	"second_weight_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tickets_plate_normalised" CHECK ("tickets"."plate" ~ '^[A-Z0-9]+$'),
	CONSTRAINT "tickets_invoice_weight_positive" CHECK ("tickets"."invoice_weight_kg" > 0),
	CONSTRAINT "tickets_held_weight_not_negative" CHECK ("tickets"."held_weight_kg" >= 0),
	CONSTRAINT "tickets_first_weight_not_negative" CHECK ("tickets"."first_weight_kg" >= 0),
	CONSTRAINT "tickets_second_weight_not_negative" CHECK ("tickets"."second_weight_kg" >= 0),
	CONSTRAINT "tickets_trip_no_positive" CHECK ("tickets"."trip_no" >= 1),
	CONSTRAINT "tickets_mismatch_attempts_not_negative" CHECK ("tickets"."mismatch_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transporters" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transporters_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	CONSTRAINT "transporters_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "unloading_points" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unloading_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"supervisor_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unloading_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "unloading_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"material_id" integer,
	"trip_from" integer,
	"trip_to" integer,
	"point_id" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "unloading_rules_shape" CHECK (("unloading_rules"."is_default" and "unloading_rules"."trip_from" is null and "unloading_rules"."trip_to" is null)
      or (not "unloading_rules"."is_default" and "unloading_rules"."material_id" is not null and "unloading_rules"."trip_from" is not null
        and "unloading_rules"."trip_to" is not null and "unloading_rules"."trip_from" >= 1 and "unloading_rules"."trip_to" >= "unloading_rules"."trip_from"))
);
--> statement-breakpoint
CREATE TABLE "upload_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "upload_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ticket_id" integer NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_links_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"pin_hash" text NOT NULL,
	"phone" text,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"plate" text NOT NULL,
	"transporter_id" integer NOT NULL,
	CONSTRAINT "vehicles_plate_normalised" CHECK ("vehicles"."plate" ~ '^[A-Z0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_chosen_material_id_materials_id_fk" FOREIGN KEY ("chosen_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chainages" ADD CONSTRAINT "chainages_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_unloading_point_id_unloading_points_id_fk" FOREIGN KEY ("unloading_point_id") REFERENCES "public"."unloading_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloading_points" ADD CONSTRAINT "unloading_points_supervisor_id_users_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloading_rules" ADD CONSTRAINT "unloading_rules_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unloading_rules" ADD CONSTRAINT "unloading_rules_point_id_unloading_points_id_fk" FOREIGN KEY ("point_id") REFERENCES "public"."unloading_points"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_links" ADD CONSTRAINT "upload_links_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_ticket" ON "approvals" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "approvals_status_kind" ON "approvals" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "photos_ticket" ON "photos" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket" ON "ticket_events" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_ticket_no_unique" ON "tickets" USING btree ("ticket_no");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_one_open_per_plate" ON "tickets" USING btree ("plate") WHERE "tickets"."status" not in ('COMPLETED', 'REJECTED', 'BLOCKED', 'ABANDONED');--> statement-breakpoint
CREATE INDEX "tickets_plate" ON "tickets" USING btree ("plate");--> statement-breakpoint
CREATE INDEX "tickets_status" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_supervisor" ON "tickets" USING btree ("supervisor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unloading_points_code_supervisor" ON "unloading_points" USING btree ("code","supervisor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unloading_rules_one_default" ON "unloading_rules" USING btree (coalesce("material_id", 0)) WHERE "unloading_rules"."is_default";--> statement-breakpoint
CREATE INDEX "upload_links_ticket" ON "upload_links" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_unique" ON "vehicles" USING btree ("plate");