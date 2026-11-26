// Database tables (build plan section 5, plus upload_links from section 7).
// Weights are whole kilograms. All times are timestamptz.
import {
  APPROVAL_KINDS,
  APPROVAL_STATUSES,
  HOLD_WEIGHT_CHOICES,
  LANGUAGES,
  PHOTO_KINDS,
  TICKET_STATUSES,
  TICKET_TYPES,
  USER_ROLES,
} from "@trinetra/shared";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const ticketStatus = pgEnum("ticket_status", TICKET_STATUSES);
export const ticketType = pgEnum("ticket_type", TICKET_TYPES);
export const approvalKind = pgEnum("approval_kind", APPROVAL_KINDS);
export const approvalStatus = pgEnum("approval_status", APPROVAL_STATUSES);
export const holdWeightChoice = pgEnum("hold_weight_choice", HOLD_WEIGHT_CHOICES);
export const userRole = pgEnum("user_role", USER_ROLES);
export const photoKind = pgEnum("photo_kind", PHOTO_KINDS);
export const language = pgEnum("language", LANGUAGES);

const id = () => integer().primaryKey().generatedAlwaysAsIdentity();
const time = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => time("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  /** What the person types to log in, together with the PIN. */
  username: text().notNull().unique(),
  name: text().notNull(),
  role: userRole().notNull(),
  pinHash: text("pin_hash").notNull(),
  phone: text(),
});

export const materials = pgTable("materials", {
  id: id(),
  name: text().notNull().unique(),
  /** The type when no weight rule applies. With a weight rule this is TYPE_3. */
  type: ticketType().notNull(),
  /** If set: an invoice weight above this makes the ticket TYPE_2. */
  type2AboveKg: integer("type2_above_kg"),
  aliasesEn: text("aliases_en").array().notNull().default([]),
  aliasesHi: text("aliases_hi").array().notNull().default([]),
});

export const chainages = pgTable("chainages", {
  id: id(),
  code: text().notNull().unique(),
  location: text().notNull(),
  supervisorId: integer("supervisor_id")
    .notNull()
    .references(() => users.id),
});

export const unloadingPoints = pgTable("unloading_points", {
  id: id(),
  code: text().notNull(),
  name: text().notNull(),
  supervisorId: integer("supervisor_id")
    .notNull()
    .references(() => users.id),
});

export const unloadingRules = pgTable("unloading_rules", {
  id: id(),
  /** Empty only on the overall default rule. */
  materialId: integer("material_id").references(() => materials.id),
  tripFrom: integer("trip_from"),
  tripTo: integer("trip_to"),
  pointId: integer("point_id")
    .notNull()
    .references(() => unloadingPoints.id),
  isDefault: boolean("is_default").notNull().default(false),
});

export const transporters = pgTable("transporters", {
  id: id(),
  name: text().notNull().unique(),
});

export const vehicles = pgTable("vehicles", {
  id: id(),
  /** Normalised: capital letters and digits only, e.g. MH12AB1234. */
  plate: text().notNull(),
  transporterId: integer("transporter_id")
    .notNull()
    .references(() => transporters.id),
});

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text().notNull().unique(),
});

export const tickets = pgTable("tickets", {
  id: id(),
  ticketNo: text("ticket_no").notNull(),
  plate: text().notNull(),
  status: ticketStatus().notNull().default("STARTED"),
  language: language().notNull(),

  materialId: integer("material_id").references(() => materials.id),
  type: ticketType(),
  // Supplier and transporter are kept as names: an invoice can name one that is not in the lists.
  supplier: text(),
  transporter: text(),
  invoiceNo: text("invoice_no"),
  invoiceMaterial: text("invoice_material"),
  invoiceDate: date("invoice_date"),
  invoiceWeightKg: integer("invoice_weight_kg"),

  /** First weight waiting for the store officer (Type 2). */
  heldWeightKg: integer("held_weight_kg"),
  firstWeightKg: integer("first_weight_kg"),
  secondWeightKg: integer("second_weight_kg"),
  /** May be zero or negative: that sends the ticket to HOLD_PENDING. */
  netKg: integer("net_kg"),
  variancePct: numeric("variance_pct", { precision: 12, scale: 3, mode: "number" }),

  tripNo: integer("trip_no"),
  unloadingPointId: integer("unloading_point_id").references(() => unloadingPoints.id),
  supervisorId: integer("supervisor_id").references(() => users.id),

  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  mismatchAttempts: integer("mismatch_attempts").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),

  createdAt: createdAt(),
  updatedAt: time("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  firstWeightAt: time("first_weight_at"),
  secondWeightAt: time("second_weight_at"),
  /** When the ticket reached a closed status. */
  closedAt: time("closed_at"),
});

export const photos = pgTable("photos", {
  // Random id: it is sent to the cameras and used in links, so it must not be guessable.
  id: uuid().primaryKey().defaultRandom(),
  /** Empty for plate photos taken before the ticket is started. */
  ticketId: integer("ticket_id").references(() => tickets.id),
  kind: photoKind().notNull(),
  storagePath: text("storage_path").notNull(),
  sha256: text().notNull(),
  takenAt: time("taken_at").notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: id(),
  /** Empty only for DRIVER_HELP pressed before a ticket exists. */
  ticketId: integer("ticket_id").references(() => tickets.id),
  kind: approvalKind().notNull(),
  status: approvalStatus().notNull().default("PENDING"),
  decidedBy: integer("decided_by").references(() => users.id),
  reason: text(),
  chosenWeight: holdWeightChoice("chosen_weight"),
  chosenMaterialId: integer("chosen_material_id").references(() => materials.id),
  photoId: uuid("photo_id").references(() => photos.id),
  plateRead: text("plate_read"),
  plateMatch: boolean("plate_match"),
  gps: jsonb().$type<{ lat: number; lng: number; accuracyM?: number }>(),
  createdAt: createdAt(),
  decidedAt: time("decided_at"),
});

export const ticketEvents = pgTable("ticket_events", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => tickets.id),
  type: text().notNull(),
  /** "system", "device:<name>" or "user:<id>". */
  actor: text().notNull(),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const uploadLinks = pgTable("upload_links", {
  id: id(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => tickets.id),
  /** Only a hash is stored, so the database never holds a usable code. */
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: time("expires_at").notNull(),
  usedAt: time("used_at"),
  createdAt: createdAt(),
});

export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb().$type<number | string | boolean>().notNull(),
});
