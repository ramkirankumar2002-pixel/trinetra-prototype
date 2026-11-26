// Demo replacements (build plan step 59), switched by rows in the settings table.
import { SAMPLE_INVOICE_IDS } from "@trinetra/shared/seed";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { settings } from "../../db/schema";

const mode = z.enum(["real", "pick"]).default("real");

const modesSchema = z.object({
  /** "pick": use the demo_plate from the vehicle list instead of the cameras. */
  anpr_mode: mode,
  /** "pick": use the demo_invoice sample instead of reading a file. */
  ocr_mode: mode,
  demo_plate: z.string().optional(),
  demo_invoice: z.enum(SAMPLE_INVOICE_IDS).optional(),
});

export type ReaderModes = z.infer<typeof modesSchema>;

/** A missing mode means real. A misspelled value throws: it must not silently do something else. */
export async function loadReaderModes(db: Database): Promise<ReaderModes> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.keys(modesSchema.shape)));
  return modesSchema.parse(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}
