// Net weight and tolerance (build plan section 6, rules 9 and 10).
import { isPositiveWholeKg } from "./classify";

export const DEFAULT_TOLERANCE_PCT = 0.5;

/** The reason the plan puts on a HOLD when the two weighings make no sense. */
export const WEIGHTS_NOT_VALID = "weights not valid";

export type NetResult =
  | { valid: true; netKg: number }
  /** netKg is null when a weighing itself is unusable, so there is nothing to subtract. */
  | { valid: false; netKg: number | null; reason: typeof WEIGHTS_NOT_VALID };

/** First (loaded) minus second (empty). Zero or negative is invalid. */
export function computeNet(firstKg: number, secondKg: number): NetResult {
  // A weighing of zero is not a truck, so it is refused rather than subtracted.
  if (!isPositiveWholeKg(firstKg) || !isPositiveWholeKg(secondKg)) {
    return { valid: false, netKg: null, reason: WEIGHTS_NOT_VALID };
  }
  const netKg = firstKg - secondKg;
  return netKg > 0 ? { valid: true, netKg } : { valid: false, netKg, reason: WEIGHTS_NOT_VALID };
}

export type ToleranceResult =
  | {
      valid: true;
      pass: boolean;
      /** |net − invoice| ÷ invoice × 100, rounded to 2 decimals. */
      variancePct: number;
      /** Net minus invoice: negative means less arrived than was invoiced. */
      differenceKg: number;
    }
  | { valid: false; pass: false; reason: string };

/**
 * Passes when the rounded variance is at most `pct`. Because it is rounded first,
 * with 0.5 % a true variance below 0.505 % passes.
 */
export function checkTolerance(
  netKg: number,
  invoiceKg: number,
  pct: number = DEFAULT_TOLERANCE_PCT,
): ToleranceResult {
  if (!Number.isFinite(pct) || pct < 0) {
    throw new RangeError(`The tolerance must be zero or more, not ${pct}.`);
  }
  if (!isPositiveWholeKg(netKg)) return { valid: false, pass: false, reason: WEIGHTS_NOT_VALID };
  if (!isPositiveWholeKg(invoiceKg)) {
    return { valid: false, pass: false, reason: "invoice weight not valid" };
  }
  const differenceKg = netKg - invoiceKg;
  // Multiply before dividing: whole numbers stay exact, so halves round up correctly.
  const variancePct = Math.round((Math.abs(differenceKg) * 10_000) / invoiceKg) / 100;
  return { valid: true, pass: variancePct <= pct, variancePct, differenceKg };
}
