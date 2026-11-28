// The made-up SAMPLE invoices, one per demo scenario. The files in
// scripts/sample-invoices/ are drawn from this data (pnpm sim:invoices), and
// "pick" demo mode returns it without reading any file.
import type { TicketType } from "../domain";
import { DEFAULT_MODEL_SCALE } from "../hardware";

export const SAMPLE_INVOICE_IDS = [
  "cement",
  "steel-scrap",
  "sand",
  "aggregate",
  "steel-bars",
  "bitumen",
  // For the real model weighbridge (docs/HARDWARE.md).
  "model-cement",
  "model-steel-bars",
  "model-bitumen",
  "model-steel-scrap",
  "model-sand",
  "model-aggregate",
  "model-bricks",
] as const;
export type SampleInvoiceId = (typeof SAMPLE_INVOICE_IDS)[number];

/** The cargo the "model-" bills are written for, in grams on the model weighbridge. */
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

const SCENARIO_INVOICES: readonly SampleInvoice[] = [
  {
    id: "cement",
    scenario: "Type 1: a supervisor checks the truck",
    printed: {
      invoice_number: "SMPL-CEM-001",
      invoice_date: "2026-11-26",
      supplier: "Sample Cement Depot",
      transporter: "Sri Balaji Transport",
      vehicle_number: "MH 12 AB 1234",
      material: "OPC 53 Grade Cement",
      quantity: 14.31,
      quantity_unit: "MT",
    },
    quantityText: "14.310",
    expected: { material: "Cement Bags", weightKg: 14_310, type: "TYPE_1" },
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
      quantity: 1500,
      quantity_unit: "kg",
    },
    quantityText: "1,500",
    expected: { material: "Steel Scrap", weightKg: 1500, type: "TYPE_2" },
  },
  {
    id: "sand",
    scenario: "Type 3: no person needed",
    printed: {
      invoice_number: "SMPL-SND-003",
      invoice_date: "2026-11-26",
      supplier: "Narmada Sand Suppliers",
      transporter: "Highway Carriers",
      vehicle_number: "MP 09 JK 7890",
      material: "River Sand",
      quantity: 9,
      quantity_unit: "Quintal",
    },
    quantityText: "9",
    expected: { material: "Sand", weightKg: 900, type: "TYPE_3" },
  },
  {
    id: "aggregate",
    // The simulator's loaded and empty trucks differ by 14,310 kg: 1.31 % less than this.
    scenario: "Tolerance fail: the weight will not match",
    printed: {
      invoice_number: "SMPL-AGG-004",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Kisan Roadlines",
      vehicle_number: "DL 01 NP 6789",
      material: "Crushed Stone Aggregate 20 mm",
      quantity: 14.5,
      quantity_unit: "MT",
    },
    quantityText: "14.500",
    expected: { material: "Aggregate 20 mm", weightKg: 14_500, type: "TYPE_2" },
  },
  {
    id: "steel-bars",
    scenario: "Type 1 at another unloading point: its own supervisor checks",
    printed: {
      invoice_number: "SMPL-BAR-005",
      invoice_date: "2026-11-26",
      supplier: "Ganga Steel Traders",
      transporter: "Highway Carriers",
      vehicle_number: "RJ 14 LM 2345",
      material: "TMT Steel Bars Fe500",
      quantity: 14.31,
      quantity_unit: "MT",
    },
    quantityText: "14.310",
    expected: { material: "Steel Bars", weightKg: 14_310, type: "TYPE_1" },
  },
  {
    id: "bitumen",
    scenario: "Type 1: the supervisor depends on the trip number",
    printed: {
      invoice_number: "SMPL-BIT-006",
      invoice_date: "2026-11-26",
      supplier: "Shree Ram Crushers",
      transporter: "Kisan Roadlines",
      vehicle_number: "BR 06 QR 4321",
      material: "VG-30 Bitumen",
      quantity: 14.31,
      quantity_unit: "MT",
    },
    quantityText: "14.310",
    expected: { material: "Bitumen", weightKg: 14_310, type: "TYPE_1" },
  },
];

/**
 * A bill for the model weighbridge: the same truck (plate, supplier, transporter) as the
 * material's other sample, carrying the model cargo.
 */
function modelBill(
  id: SampleInvoiceId,
  number: number,
  truck: Pick<SampleInvoice["printed"], "supplier" | "transporter" | "vehicle_number">,
  printedMaterial: string,
  material: string,
  type: TicketType,
): SampleInvoice {
  return {
    id,
    scenario: `Model weighbridge, ${MODEL_CARGO_G} g cargo: ${material}`,
    printed: {
      invoice_number: `SMPL-MOD-${String(number).padStart(3, "0")}`,
      invoice_date: "2026-11-26",
      supplier: truck.supplier,
      transporter: truck.transporter,
      vehicle_number: truck.vehicle_number,
      material: printedMaterial,
      quantity: MODEL_CARGO_KG / 1000,
      quantity_unit: "MT",
    },
    quantityText: (MODEL_CARGO_KG / 1000).toFixed(3),
    expected: { material, weightKg: MODEL_CARGO_KG, type },
  };
}

/** The model bill for the material of another sample, with that sample's truck. */
function modelBillLike(
  id: SampleInvoiceId,
  number: number,
  like: SampleInvoiceId,
  type: TicketType,
): SampleInvoice {
  const { printed, expected } = SCENARIO_INVOICES.find((invoice) => invoice.id === like)!;
  return modelBill(id, number, printed, printed.material, expected.material, type);
}

export const SAMPLE_INVOICES: readonly SampleInvoice[] = [
  ...SCENARIO_INVOICES,
  modelBillLike("model-cement", 1, "cement", "TYPE_1"),
  modelBillLike("model-steel-bars", 2, "steel-bars", "TYPE_1"),
  modelBillLike("model-bitumen", 3, "bitumen", "TYPE_1"),
  // 20,000 kg is above these materials' thresholds, so the store officer checks them.
  modelBillLike("model-steel-scrap", 4, "steel-scrap", "TYPE_2"),
  modelBillLike("model-sand", 5, "sand", "TYPE_2"),
  modelBillLike("model-aggregate", 6, "aggregate", "TYPE_2"),
  // Bricks are always Type 3: the run that needs no person.
  modelBill(
    "model-bricks",
    7,
    {
      supplier: "Shree Ram Crushers",
      transporter: "Sri Balaji Transport",
      vehicle_number: "MH 14 CD 5678",
    },
    "Red Clay Bricks",
    "Bricks",
    "TYPE_3",
  ),
];
