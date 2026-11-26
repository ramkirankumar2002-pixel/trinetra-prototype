// Ticket numbers and how weights and times are shown (build plan sections 5 and 13).
// Digits are 0-9 in both languages.
import { WEIGHBRIDGE_ID } from "./weighbridge";

/** India Standard Time is UTC+5:30 all year, so no time zone database is needed. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** The calendar date and clock time in India for a moment. */
function inIndia(date: Date) {
  const time = date.getTime();
  if (Number.isNaN(time)) throw new RangeError("Not a valid date.");
  const shifted = new Date(time + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/**
 * "WB01-20261126-0001": weighbridge, date in India, and the running number for that day.
 * The caller (the database) must make sure the running number is not used twice.
 */
export function ticketNumber(
  date: Date,
  runningNumber: number,
  weighbridgeId: string = WEIGHBRIDGE_ID,
): string {
  if (!Number.isSafeInteger(runningNumber) || runningNumber < 1) {
    throw new RangeError(`The running number starts at 1, not ${runningNumber}.`);
  }
  const { year, month, day } = inIndia(date);
  const bridge = weighbridgeId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${bridge}-${year}${pad(month)}${pad(day)}-${pad(runningNumber, 4)}`;
}

/** 3256000 -> "32,56,000 kg": Indian grouping (last three digits, then twos). */
export function formatKg(kg: number): string {
  if (!Number.isFinite(kg)) throw new RangeError("Not a weight.");
  const whole = Math.round(kg);
  const digits = String(Math.abs(whole));
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ",");
  const grouped = head ? `${head},${digits.slice(-3)}` : digits;
  return `${whole < 0 ? "-" : ""}${grouped} kg`;
}

/** "26 Nov 2026, 14:05 IST" (24 hour clock), whatever the device's time zone is. */
export function formatIST(date: Date): string {
  const { year, month, day, hour, minute } = inIndia(date);
  return `${day} ${MONTHS[month - 1]} ${year}, ${pad(hour)}:${pad(minute)} IST`;
}
