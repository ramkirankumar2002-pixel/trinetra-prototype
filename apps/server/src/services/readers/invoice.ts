// Reading an invoice (build plan step 58): unreadable fields stay empty, never guessed.
import {
  matchFromList,
  matchMaterial,
  normalizePlate,
  formatPlate,
  type InvoiceRead,
  type InvoiceWarning,
  type MatchableMaterial,
  type MatchedValue,
} from "@trinetra/shared";
import { z } from "zod";
import { filePart, type Gemini } from "./gemini";

const PROMPT = [
  "This is a delivery invoice or weighment document for building material brought by a truck in India.",
  "Copy these fields exactly as they are printed. If a field is not on the document, or you",
  "cannot read it with certainty, return null for it. Never guess, calculate or fill in a value.",
  "- invoice_number",
  "- invoice_date, written as YYYY-MM-DD (Indian documents write the day before the month)",
  "- supplier: the company that sells and sends the material, not the buyer",
  "- transporter: the company that carries it",
  "- vehicle_number: the truck's registration number",
  "- material: the description of the goods, as written",
  "- quantity: the net weight of the goods if one is printed, otherwise the quantity of the goods,",
  "  as a plain number without commas (do not convert units)",
  '- quantity_unit: the unit printed for that number, as written (for example "kg", "MT",',
  '  "Quintal", "Bags")',
].join("\n");

const TEXT_FIELDS = [
  "invoice_number",
  "invoice_date",
  "supplier",
  "transporter",
  "vehicle_number",
  "material",
  "quantity_unit",
] as const;

const responseJsonSchema = {
  type: "object",
  properties: {
    ...Object.fromEntries(TEXT_FIELDS.map((name) => [name, { type: ["string", "null"] }])),
    quantity: { type: ["number", "null"] },
  },
  required: [...TEXT_FIELDS, "quantity"],
};

const text = z.string().nullable();
export const rawInvoiceSchema = z.object({
  invoice_number: text,
  invoice_date: text,
  supplier: text,
  transporter: text,
  vehicle_number: text,
  material: text,
  quantity: z.number().nullable(),
  quantity_unit: text,
});
export type RawInvoice = z.infer<typeof rawInvoiceSchema>;

/** Ways a reader may say "nothing there" instead of null. */
const EMPTY_WORDS = new Set(["", "null", "none", "n/a", "na", "-", "--", "unknown", "not visible"]);

function clean(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  return EMPTY_WORDS.has(trimmed.toLowerCase()) ? null : trimmed.slice(0, 200);
}

function realDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  // Rejects dates such as 2026-02-31, which JavaScript would move into March.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null;
}

const KG_PER_UNIT = new Map<string, number>(
  (
    [
      [1, "kg kgs kilogram kilograms kilo kilos किलो किलोग्राम"],
      [100, "quintal quintals qtl qtls qntl क्विंटल"],
      [1000, "t mt mts ton tons tonne tonnes metricton metrictons metrictonne metrictonnes टन"],
    ] as const
  ).flatMap(([factor, names]) => names.split(" ").map((name) => [name, factor] as const)),
);

/** More than any truck can carry: a number this big has been misread. */
const MAX_INVOICE_KG = 200_000;

/** Whole kilograms, or null for a unit we cannot convert (bags, cubic metres, none). */
export function toKg(value: number | null, unit: string | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0 || unit === null) return null;
  const factor = KG_PER_UNIT.get(unit.toLowerCase().replace(/[\s.]/g, ""));
  if (factor === undefined) return null;
  const kg = Math.round(value * factor);
  return kg > 0 && kg <= MAX_INVOICE_KG ? kg : null;
}

export interface InvoiceLists {
  materials: MatchableMaterial[];
  suppliers: string[];
  transporters: string[];
}

const matched = (
  raw: string | null,
  name: (value: string) => string | undefined,
): MatchedValue => ({
  raw,
  matched: raw === null ? null : (name(raw) ?? null),
});

/** Turns the fields as written into checked values. Used for real and demo invoices alike. */
export function interpretInvoice(
  raw: RawInvoice,
  context: {
    lists: InvoiceLists;
    /** The plate read at the weighbridge, if there is a ticket. */
    ticketPlate: string | null;
    source: InvoiceRead["source"];
    ms: number;
  },
): InvoiceRead {
  const { lists, ticketPlate, source, ms } = context;
  const material = matched(
    clean(raw.material),
    (value) => matchMaterial(value, lists.materials)?.material.name,
  );
  const vehicleRaw = clean(raw.vehicle_number);
  const vehiclePlate = vehicleRaw === null ? null : normalizePlate(vehicleRaw) || null;
  const value =
    raw.quantity !== null && Number.isFinite(raw.quantity) && raw.quantity > 0
      ? raw.quantity
      : null;
  const unit = clean(raw.quantity_unit);
  const weightKg = toKg(value, unit);

  const warnings: InvoiceWarning[] = [];
  if (ticketPlate && vehiclePlate && vehiclePlate !== normalizePlate(ticketPlate)) {
    warnings.push({
      code: "VEHICLE_MISMATCH",
      message: `The invoice is for ${formatPlate(vehiclePlate)}, but this truck is ${formatPlate(ticketPlate)}.`,
    });
  }
  if (value !== null && weightKg === null) {
    warnings.push({
      code: "WEIGHT_UNIT_UNKNOWN",
      message: `No weight could be worked out from "${value} ${unit ?? "(no unit)"}".`,
    });
  }
  if (material.raw !== null && material.matched === null) {
    warnings.push({
      code: "MATERIAL_NOT_RECOGNISED",
      message: `"${material.raw}" is not clearly one of our materials.`,
    });
  }

  return {
    invoiceNo: clean(raw.invoice_number),
    invoiceDate: realDate(clean(raw.invoice_date)),
    supplier: matched(clean(raw.supplier), (v) => matchFromList(v, lists.suppliers)?.name),
    transporter: matched(clean(raw.transporter), (v) => matchFromList(v, lists.transporters)?.name),
    material,
    vehicle: { raw: vehicleRaw, plate: vehiclePlate },
    quantity: { value, unit },
    weightKg,
    warnings,
    source,
    ms,
  };
}

/** Sends a JPEG or PDF to Gemini. Throws a ReaderError if Gemini cannot be used. */
export async function readInvoiceWithGemini(
  gemini: Gemini,
  file: { data: Buffer; contentType: string },
  context: { lists: InvoiceLists; ticketPlate: string | null },
): Promise<InvoiceRead> {
  const started = performance.now();
  const raw = await gemini.generateJson({
    parts: [filePart(file.data, file.contentType), { type: "text", text: PROMPT }],
    schema: responseJsonSchema,
    validate: rawInvoiceSchema,
  });
  return interpretInvoice(raw, {
    ...context,
    source: "gemini",
    ms: Math.round(performance.now() - started),
  });
}
