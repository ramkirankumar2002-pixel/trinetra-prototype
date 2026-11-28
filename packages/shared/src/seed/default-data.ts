// All master data for the prototype (build plan section 5).
// To change a material, unloading point or setting before the demo:
// edit this file, then run `pnpm db:seed`.
//
// Import it as "@trinetra/shared/seed". It is deliberately NOT part of "@trinetra/shared",
// so the demo PINs never end up in the website's browser code.
// The PINs are for the local demo only. They are public in this repository.

import type { TicketType, UserRole } from "../domain";

export interface SeedUser {
  /** Typed at login, together with the PIN. */
  username: string;
  name: string;
  role: UserRole;
  /** 4 digits. Only a bcrypt hash is stored in the database. */
  pin: string;
  phone: string | null;
}

const supervisor = (username: string, name: string, pin: string, phone: string) =>
  ({ username, name, role: "SUPERVISOR", pin, phone }) satisfies SeedUser;

export const SEED_USERS = [
  // Phone numbers are the sample numbers from the mockups.
  supervisor("amit", "Amit Kumar", "1001", "9876543210"),
  supervisor("suresh", "Suresh Yadav", "1002", "9876543211"),
  supervisor("ravi", "Ravi Singh", "1003", "9876543212"),
  supervisor("mahesh", "Mahesh Patel", "1004", "9876543213"),
  supervisor("vikram", "Vikram Sharma", "1005", "9876543214"),
  supervisor("dinesh", "Dinesh Verma", "1006", "9876543215"),
  supervisor("pankaj", "Pankaj Gupta", "1007", "9876543216"),
  supervisor("ajay", "Ajay Kumar", "1008", "9876543217"),
  supervisor("deepak", "Deepak Yadav", "1009", "9876543218"),
  supervisor("rohit", "Rohit Kumar", "1010", "9876543219"),
  { username: "ram", name: "Ram (Sr. Manager)", role: "STORE", pin: "2001", phone: null },
  { username: "wb01", name: "WB-01", role: "KIOSK", pin: "3001", phone: null },
] satisfies SeedUser[];

export type SeedUsername = (typeof SEED_USERS)[number]["username"] | (string & {});

export interface SeedMaterial {
  name: string;
  /** The type when there is no weight rule. With a weight rule, keep this TYPE_3. */
  type: Exclude<TicketType, "TYPE_2">;
  /** An invoice weight above this is TYPE_2; at or below it is TYPE_3. */
  type2AboveKg: number | null;
  aliasesEn: string[];
  // Hindi words have not been checked by a native speaker yet.
  aliasesHi: string[];
}

export const SEED_MATERIALS = [
  {
    name: "Cement Bags",
    type: "TYPE_1",
    type2AboveKg: null,
    aliasesEn: ["cement", "cement bag", "cement bags"],
    aliasesHi: ["सीमेंट", "सीमेंट की बोरी"],
  },
  {
    name: "Additive",
    type: "TYPE_1",
    type2AboveKg: null,
    aliasesEn: ["additive", "additives", "admixture"],
    aliasesHi: ["एडिटिव"],
  },
  {
    name: "Bitumen",
    type: "TYPE_1",
    type2AboveKg: null,
    aliasesEn: ["bitumen", "asphalt", "tar"],
    aliasesHi: ["बिटुमेन", "डामर"],
  },
  {
    name: "Steel Bars",
    type: "TYPE_1",
    type2AboveKg: null,
    aliasesEn: ["steel bars", "steel bar", "rebar", "sariya"],
    aliasesHi: ["सरिया", "स्टील बार"],
  },
  {
    name: "Steel Scrap",
    type: "TYPE_3",
    type2AboveKg: 1000,
    aliasesEn: ["steel scrap", "scrap", "kabaad"],
    aliasesHi: ["स्क्रैप", "लोहे का कबाड़"],
  },
  {
    name: "Aggregate 20 mm",
    type: "TYPE_3",
    type2AboveKg: 500,
    aliasesEn: ["aggregate 20 mm", "20 mm aggregate", "20 mm", "20 mm gitti", "bees mm"],
    aliasesHi: ["20 एमएम गिट्टी", "बीस एमएम गिट्टी", "बीस एमएम"],
  },
  {
    name: "Aggregate 10 mm",
    type: "TYPE_3",
    type2AboveKg: 500,
    aliasesEn: ["aggregate 10 mm", "10 mm aggregate", "10 mm", "10 mm gitti", "das mm"],
    aliasesHi: ["10 एमएम गिट्टी", "दस एमएम गिट्टी", "दस एमएम"],
  },
  {
    name: "Sand",
    type: "TYPE_3",
    type2AboveKg: 1000,
    aliasesEn: ["sand", "ret", "balu"],
    aliasesHi: ["रेत", "बालू"],
  },
  {
    name: "Bricks",
    type: "TYPE_3",
    type2AboveKg: null,
    aliasesEn: ["bricks", "brick", "eent"],
    aliasesHi: ["ईंट"],
  },
] satisfies SeedMaterial[];

export interface SeedChainage {
  code: string;
  location: string;
  supervisor: SeedUsername;
}

export const SEED_CHAINAGES: SeedChainage[] = [
  { code: "CH-000+000", location: "Project Start Point", supervisor: "amit" },
  { code: "CH-001+500", location: "Near Village Rampur", supervisor: "suresh" },
  { code: "CH-003+250", location: "Bridge Approach Road", supervisor: "ravi" },
  { code: "CH-005+000", location: "Hill Section Area", supervisor: "mahesh" },
  { code: "CH-007+750", location: "Near Check Dam", supervisor: "vikram" },
  { code: "CH-010+000", location: "Middle Section Point", supervisor: "dinesh" },
  { code: "CH-012+500", location: "Valley Crossing", supervisor: "pankaj" },
  { code: "CH-015+000", location: "Near Quarry Area", supervisor: "ajay" },
  { code: "CH-017+800", location: "Road Curve Point", supervisor: "deepak" },
  { code: "CH-020+000", location: "Project End Point", supervisor: "rohit" },
];

export interface SeedUnloadingPoint {
  /** Name used by the rules below. Not stored in the database. */
  key: string;
  code: string;
  name: string;
  supervisor: SeedUsername;
}

// These come from the unloading rules, which win where they differ from the chainage list.
export const SEED_UNLOADING_POINTS = [
  { key: "PLANT", code: "Plant", name: "Plant", supervisor: "amit" },
  // The same place with the contact the rules give for Steel Scrap.
  { key: "PLANT_SCRAP", code: "Plant", name: "Plant", supervisor: "dinesh" },
  { key: "CH-005+250", code: "CH-005+250", name: "Hill Section Area", supervisor: "ravi" },
  { key: "CH-009+800", code: "CH-009+800", name: "Near Quarry Area", supervisor: "mahesh" },
  { key: "CH-003+750", code: "CH-003+750", name: "Bridge Approach Road", supervisor: "suresh" },
  { key: "CH-010+500", code: "CH-010+500", name: "Middle Section Point", supervisor: "vikram" },
  { key: "CH-012+300", code: "CH-012+300", name: "Valley Crossing", supervisor: "pankaj" },
] as const satisfies readonly SeedUnloadingPoint[];

export type SeedMaterialName = (typeof SEED_MATERIALS)[number]["name"];
export type SeedPointKey = (typeof SEED_UNLOADING_POINTS)[number]["key"];

export interface SeedUnloadingRule {
  material: SeedMaterialName;
  /** Trip numbers, both ends included, counted per material. */
  tripFrom: number;
  tripTo: number;
  point: SeedPointKey;
}

export const SEED_UNLOADING_RULES: SeedUnloadingRule[] = [
  { material: "Cement Bags", tripFrom: 1, tripTo: 999, point: "PLANT" },
  // Added for the demo (not in the mockups), so Type 1 trucks reach different supervisors.
  // Additive has no rule: it goes to the default point.
  { material: "Steel Bars", tripFrom: 1, tripTo: 999, point: "CH-010+500" },
  { material: "Bitumen", tripFrom: 1, tripTo: 2, point: "CH-003+750" },
  { material: "Bitumen", tripFrom: 3, tripTo: 999, point: "CH-012+300" },
  { material: "Aggregate 10 mm", tripFrom: 1, tripTo: 3, point: "CH-005+250" },
  { material: "Aggregate 10 mm", tripFrom: 4, tripTo: 999, point: "CH-009+800" },
  { material: "Aggregate 20 mm", tripFrom: 1, tripTo: 4, point: "CH-003+750" },
  { material: "Aggregate 20 mm", tripFrom: 5, tripTo: 999, point: "CH-010+500" },
  { material: "Sand", tripFrom: 1, tripTo: 999, point: "CH-012+300" },
  { material: "Steel Scrap", tripFrom: 1, tripTo: 999, point: "PLANT_SCRAP" },
];

/** Used when a material has no rule, or the trip number is past every range. */
export const SEED_DEFAULT_POINT: SeedPointKey = "PLANT";

// Sample fleet and suppliers: not in the mockups.
// Replace the plates with the ones printed on the truck models.
export const SEED_TRANSPORTERS = [
  "Sri Balaji Transport",
  "Maa Durga Logistics",
  "Highway Carriers",
  "Kisan Roadlines",
] as const;

export const SEED_VEHICLES: { plate: string; transporter: (typeof SEED_TRANSPORTERS)[number] }[] = [
  { plate: "MH12AB1234", transporter: "Sri Balaji Transport" },
  { plate: "MH14CD5678", transporter: "Sri Balaji Transport" },
  { plate: "UP32EF9012", transporter: "Maa Durga Logistics" },
  { plate: "UP70GH3456", transporter: "Maa Durga Logistics" },
  { plate: "MP09JK7890", transporter: "Highway Carriers" },
  { plate: "RJ14LM2345", transporter: "Highway Carriers" },
  { plate: "DL01NP6789", transporter: "Kisan Roadlines" },
  { plate: "BR06QR4321", transporter: "Kisan Roadlines" },
];

export const SEED_SUPPLIERS = [
  "Shree Ram Crushers",
  "Sample Cement Depot",
  "Ganga Steel Traders",
  "Narmada Sand Suppliers",
];

export const SEED_SETTINGS = {
  weighbridge_id: "WB-01",
  tolerance_pct: 0.5,
  mismatch_attempts: 5,
  stable_window_seconds: 3,
  stable_band_kg: 10,
  // Placeholder: the plan gives no value. In truck kilograms; tune on the real model (Phase 5).
  wake_threshold_kg: 500,
  // Placeholder: model weight to truck kilograms. Calibrate on the real model (Phase 5).
  scale_factor: 1,
  // Demo replacements, if something fails on stage. "real" or "pick".
  anpr_mode: "real",
  // The reading of the supervisor's photo has its own switch.
  supervisor_anpr_mode: "real",
  ocr_mode: "real",
  // Used only in "pick" mode: a plate from SEED_VEHICLES and an id from SAMPLE_INVOICES.
  demo_plate: "MH12AB1234",
  demo_invoice: "cement",
} satisfies Record<string, number | string | boolean>;

export * from "./sample-invoices";
