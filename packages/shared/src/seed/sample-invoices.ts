// The made-up SAMPLE invoices. The files in scripts/sample-invoices/ are drawn from this
// data (pnpm sim:invoices), and "pick" demo mode returns it without reading any file.
//
// Every ordinary bill is for 20,000 kg: the net weight of the simulator's loaded and empty
// trucks, and of a 200 g cargo on the model weighbridge. Two bills differ on purpose:
// "scrap-small" (at or below the threshold: Type 3) and "aggregate-short" (will not pass).
import type { TicketType } from "../domain";
import { DEFAULT_MODEL_SCALE } from "../hardware";

export const SAMPLE_INVOICE_IDS = [
  "cement",
  "steel-scrap",
  "sand",
  "aggregate",
  "aggregate-10",
  "steel-bars",
  "bitumen",
  "bricks",
  "scrap-small",
  "aggregate-short",
] as const;
export type SampleInvoiceId = (typeof SAMPLE_INVOICE_IDS)[number];

/** The cargo most bills are written for, in grams on the model weighbridge. */
export const MODEL_CARGO_G = 200;
/** What those bills say: the model cargo at the default model scale. */
export const MODEL_CARGO_KG = MODEL_CARGO_G * DEFAULT_MODEL_SCALE;

export interface SampleInvoice {
  id: SampleInvoiceId;
  scenario: string;
  /** What is printed, in the shape the invoice reader returns. The date is YYYY-MM-DD. */
  printed: {
    invoice_number: string;
    invoice_date: string;
    supplier: string;
    transporter: string;
    vehicle_number: string;
    material: string;
    quantity: number;
    quantity_unit: string;
  };
  /** The number as it appears on the paper, e.g. "14.310" for 14.31. */
  quantityText: string;
  expected: { material: string; weightKg: number; type: TicketType };
}

export const SAMPLE_INVOICES: readonly SampleInvoice[] = [
  {
    id: "cement",
    scenario: "Type 2: the store officer approves",
    printed: {
      invoice_number: "SMPL-CEM-001",
      invoice_date: "2026-11-26",
      supplier: "Sample Cement Depot",
      transporter: "Sri Balaji Transport",
      vehicle_number: "MH 12 AB 1234",
      material: "OPC 53 Grade Cement",
      quantity: 20,
      quantity_unit: "MT",
    },
    quantityText: "20.000",
    expected: { material: "Cement Bags", weightKg: 20_000, type: "TYPE_2" },
  },
  {
    id: "steel-scrap",
    scenario: "Type 2: the store officer approves",
    printed: {
      invoice_number: "SMPL-SCR-002",
      invoice_date: "2026-11-26",
      supplier: "Ganga Steel Traders",
      transporter: "Maa Durga Logistics",
      vehicle_number: "UP 32 EF 9012",
      material: "MS Steel Scrap",
      quantity: 20000,
      quantity_unit: "kg",
    },
    quantityText: "20,000",
    expected: { material: "Steel Scrap", weightKg: 20_000, type: "TYPE_2" },
  },
  {
    id: "sand",
    scenario: "Type 1: Pankaj Gupta checks the truck",
    printed: {
      invoice_number: "SMPL-SND-003",
      invoice_date: "2026-11-26",
      supplier: "Narmada Sand Suppliers",
      transporter: "Highway Carriers",
      vehicle_number: "MP 09 JK 7890",
      material: "River Sand",
      quantity: 200,
      quantity_unit: "Quintal",
    },
    quantityText: "200",
    expected: { material: "Sand", weightKg: 20_000, type: "TYPE_1" },
  },
  {
    id: "aggregate",
    scenario: "Type 1: Suresh Yadav (trips 1 to 4), then Vikram Sharma",
    printed: {
      invoice_number: "SMPL-AGG-004",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Kisan Roadlines",
      vehicle_number: "DL 01 NP 6789",
      material: "Crushed Stone Aggregate 20 mm",
      quantity: 20,
      quantity_unit: "MT",
    },
    quantityText: "20.000",
    expected: { material: "Aggregate 20 mm", weightKg: 20_000, type: "TYPE_1" },
  },
  {
    id: "aggregate-10",
    scenario: "Type 1: Ravi Singh (trips 1 to 3), then Mahesh Patel",
    printed: {
      invoice_number: "SMPL-AGG-007",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Maa Durga Logistics",
      vehicle_number: "UP 70 GH 3456",
      material: "Crushed Stone Aggregate 10 mm",
      quantity: 20,
      quantity_unit: "MT",
    },
    quantityText: "20.000",
    expected: { material: "Aggregate 10 mm", weightKg: 20_000, type: "TYPE_1" },
  },
  {
    id: "steel-bars",
    scenario: "Type 2: the store officer approves",
    printed: {
      invoice_number: "SMPL-BAR-005",
      invoice_date: "2026-11-26",
      supplier: "Ganga Steel Traders",
      transporter: "Highway Carriers",
      vehicle_number: "RJ 14 LM 2345",
      material: "TMT Steel Bars Fe500",
      quantity: 20,
      quantity_unit: "MT",
    },
    quantityText: "20.000",
    expected: { material: "Steel Bars", weightKg: 20_000, type: "TYPE_2" },
  },
  {
    id: "bitumen",
    scenario: "Type 2: the store officer approves",
    printed: {
      invoice_number: "SMPL-BIT-006",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Kisan Roadlines",
      vehicle_number: "BR 06 QR 4321",
      material: "VG-30 Bitumen",
      quantity: 20,
      quantity_unit: "MT",
    },
    quantityText: "20.000",
    expected: { material: "Bitumen", weightKg: 20_000, type: "TYPE_2" },
  },
  {
    id: "bricks",
    scenario: "Type 3: no person needed",
    printed: {
      invoice_number: "SMPL-BRK-008",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Sri Balaji Transport",
      vehicle_number: "MH 14 CD 5678",
      material: "Red Clay Bricks",
      quantity: 20,
      quantity_unit: "MT",
    },
    quantityText: "20.000",
    expected: { material: "Bricks", weightKg: 20_000, type: "TYPE_3" },
  },
  {
    id: "scrap-small",
    scenario: "Type 3 by weight: 900 kg, at or below the 1,000 kg threshold",
    printed: {
      invoice_number: "SMPL-SCR-009",
      invoice_date: "2026-11-26",
      supplier: "Ganga Steel Traders",
      transporter: "Maa Durga Logistics",
      vehicle_number: "UP 32 EF 9012",
      material: "MS Steel Scrap",
      quantity: 9,
      quantity_unit: "Quintal",
    },
    quantityText: "9",
    expected: { material: "Steel Scrap", weightKg: 900, type: "TYPE_3" },
  },
  {
    id: "aggregate-short",
    scenario: "Tolerance fail: 20,000 kg arrives, 20,200 kg is invoiced",
    printed: {
      invoice_number: "SMPL-AGG-010",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Kisan Roadlines",
      vehicle_number: "DL 01 NP 6789",
      material: "Crushed Stone Aggregate 20 mm",
      quantity: 20.2,
      quantity_unit: "MT",
    },
    quantityText: "20.200",
    expected: { material: "Aggregate 20 mm", weightKg: 20_200, type: "TYPE_1" },
  },
];
