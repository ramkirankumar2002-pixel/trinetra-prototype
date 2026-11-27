// Number plates (build plan section 5: uppercase, spaces and dashes removed).
import type { PlateMatchResult } from "../domain";

/** "mh 12-ab 1234" -> "MH12AB1234". Removes spaces, dashes and dots; changes nothing else. */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[\s.·\-‐-―]/g, "");
}

/** State, district, series (may be empty), number: MH 12 AB 1234. */
const STATE_PLATE = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{4})$/;
/** Bharat series: year, BH, number, letters (never I or O): 22 BH 1234 AA. */
const BHARAT_PLATE = /^(\d{2})(BH)(\d{4})([A-HJ-NP-Z]{1,2})$/;

function plateParts(normalised: string): string[] | undefined {
  const match = BHARAT_PLATE.exec(normalised) ?? STATE_PLATE.exec(normalised);
  return match?.slice(1).filter((part) => part !== "");
}

/** Checks the shape only. It does not check that the state or district code exists. */
export function isValidIndianPlate(plate: string): boolean {
  return plateParts(normalizePlate(plate)) !== undefined;
}

/** "MH12AB1234" -> "MH 12 AB 1234". A plate of another shape is returned normalised. */
export function formatPlate(plate: string): string {
  const normalised = normalizePlate(plate);
  return plateParts(normalised)?.join(" ") ?? normalised;
}

/** One character changed, missing or extra. */
function oneCharacterApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && a[start] === b[start]) start++;
  if (start === a.length && start === b.length) return false;
  // What is left after the first difference must be the same.
  const skipA = a.length >= b.length ? 1 : 0;
  const skipB = b.length >= a.length ? 1 : 0;
  return a.slice(start + skipA) === b.slice(start + skipB);
}

/** The supervisor's photo against the ticket's plate. CLOSE is not a match. */
export function comparePlates(
  read: string | null,
  ticketPlate: string,
): Exclude<PlateMatchResult, "MANUAL"> {
  const seen = normalizePlate(read ?? "");
  if (seen === "") return "NOT_READ";
  const wanted = normalizePlate(ticketPlate);
  if (seen === wanted) return "MATCH";
  return oneCharacterApart(seen, wanted) ? "CLOSE" : "NO_MATCH";
}

/** True when the front and back reads are the same plate. Two empty reads do not match. */
export function platesMatch(front: string, back: string): boolean {
  const normalised = normalizePlate(front);
  return normalised !== "" && normalised === normalizePlate(back);
}
