// The weighbridge settings come from the settings table (edit default-data.ts, run db:seed).
import { gramsToKg, MAX_MODEL_SCALE } from "@trinetra/shared";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client";
import { settings } from "../db/schema";
import type { HardwareSettings } from "./state";

// The thresholds are in grams on the model, as the load cells measure; everything else in
// the backend works in truck kilograms.
const rowsSchema = z.object({
  model_scale_kg_per_g: z.number().positive().max(MAX_MODEL_SCALE),
  wake_threshold_g: z.number().positive(),
  stable_window_seconds: z.number().positive().max(60),
  stable_band_g: z.number().nonnegative(),
});

export async function loadHardwareSettings(db: Database): Promise<HardwareSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.keys(rowsSchema.shape)));
  // Fails if a setting is missing or wrong: better no capture than a guessed threshold.
  const values = rowsSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
  const scale = values.model_scale_kg_per_g;
  return {
    wakeThresholdKg: gramsToKg(values.wake_threshold_g, scale),
    stableWindowMs: values.stable_window_seconds * 1000,
    stableSpreadKg: gramsToKg(values.stable_band_g, scale),
    modelScaleKgPerG: scale,
  };
}
