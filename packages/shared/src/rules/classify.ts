// Ticket type (build plan section 6, rule 4).
import type { TicketType } from "../domain";

export interface TypedMaterial {
  name: string;
  /** The type without a weight rule. */
  type: TicketType;
  /** If set: an invoice weight above this is TYPE_2, at or below it TYPE_3. */
  type2AboveKg: number | null;
}

export type ClassifyResult =
  | { ok: true; type: TicketType; reason: string }
  | { ok: false; error: "INVOICE_WEIGHT_REQUIRED" | "INVOICE_WEIGHT_INVALID"; reason: string };

/** A weight the database can hold: whole kilograms above zero. */
export function isPositiveWholeKg(kg: unknown): kg is number {
  return typeof kg === "number" && Number.isSafeInteger(kg) && kg > 0;
}

/**
 * `invoiceKg` is the weight read from the invoice. It only matters for materials with a
 * weight rule; without a usable value the answer is an error, never a guessed type.
 */
export function classifyType(
  material: TypedMaterial,
  invoiceKg: number | null | undefined,
): ClassifyResult {
  const { name, type, type2AboveKg: limit } = material;

  if (limit === null) {
    return { ok: true, type, reason: `${name} is always this type.` };
  }
  if (invoiceKg === null || invoiceKg === undefined) {
    return {
      ok: false,
      error: "INVOICE_WEIGHT_REQUIRED",
      reason: `${name} needs the invoice weight to decide the type.`,
    };
  }
  if (!isPositiveWholeKg(invoiceKg)) {
    return {
      ok: false,
      error: "INVOICE_WEIGHT_INVALID",
      reason: "The invoice weight must be a whole number of kilograms above zero.",
    };
  }
  return invoiceKg > limit
    ? { ok: true, type: "TYPE_2", reason: `${name}: the invoice weight is above ${limit} kg.` }
    : { ok: true, type: "TYPE_3", reason: `${name}: the invoice weight is ${limit} kg or less.` };
}
