// Stable weight (build plan section 6, rule 6).

export interface WeightReading {
  kg: number;
  /** The ESP32's own stable flag. */
  stable: boolean;
  /** When the backend received it, in milliseconds. */
  at: number;
}

/**
 * The ESP32 sends a reading about every 200 ms. A longer silence than this inside the window
 * means we do not know what the weight did, so it does not count as stable.
 */
export const MAX_READING_GAP_MS = 1000;

/**
 * True only if the weight held still for the whole window ending at the newest reading:
 * every reading is within ±`spreadKg` of the newest one (the one that would be captured)
 * and has the ESP32 stable flag on.
 *
 * It judges the readings only. The caller must also check that the newest one is recent
 * and that a truck is there: a steady empty bridge is "stable" too.
 */
export function isStable(
  readings: readonly WeightReading[],
  windowMs = 3000,
  spreadKg = 10,
  maxGapMs = MAX_READING_GAP_MS,
): boolean {
  const ordered = [...readings].sort((a, b) => a.at - b.at);
  const latest = ordered.at(-1);
  if (!latest) return false;

  // Start at the last reading taken at or before the window began, because it shows the
  // weight at that moment. Without one, there is not yet a full window of history.
  const windowStart = latest.at - windowMs;
  const first = ordered.filter((reading) => reading.at <= windowStart).length - 1;
  if (first < 0) return false;
  const window = ordered.slice(first);

  return window.every(
    (reading, index) =>
      reading.stable &&
      Number.isFinite(reading.kg) &&
      Math.abs(reading.kg - latest.kg) <= spreadKg &&
      (index === 0 || reading.at - window[index - 1]!.at <= maxGapMs),
  );
}
