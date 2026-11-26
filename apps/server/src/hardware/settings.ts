// The weighbridge settings come from the settings table (edit default-data.ts, run db:seed).
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { settings } from "../db/schema";
import type { HardwareSettings } from "./state";

const rowsSchema = z.object({
  wake_threshold_kg: z.number().positive(),
  stable_window_seconds: z.number().positive().max(60),
  stable_band_kg: z.number().nonnegative(),
});

export async function loadHardwareSettings(db: Database): Promise<HardwareSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.keys(rowsSchema.shape)));
  // Fails if a setting is missing or wrong: better no capture than a guessed threshold.
  const values = rowsSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  return {
    wakeThresholdKg: values.wake_threshold_kg,
    stableWindowMs: values.stable_window_seconds * 1000,
    stableSpreadKg: values.stable_band_kg,
  };
}
