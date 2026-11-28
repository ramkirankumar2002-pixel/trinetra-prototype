// Messages on the /device WebSocket (build plan section 7; README "Device connection").
// Only the main ESP32 uses it. Everything it sends is checked here; anything else is
// ignored. The cameras send their frames over HTTP instead (routes/camera-frame.ts).
import {
  DISPLAY_LINE_CHARS,
  DISPLAY_MAX_LINES,
  LIGHT_STATES,
  TAMPER_REASONS,
  TRUCK_POSITIONS,
  type Lights,
} from "@trinetra/shared";
import { z } from "zod";

/** Far above any model truck: a reading outside this is a fault, not a weight. */
export const MAX_GRAMS = 100_000;

export const mainMessageSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("w"),
    /**
     * Grams on the model, as the load cells measure them. The backend turns them into truck
     * kilograms. Slightly below zero is normal when the empty bridge drifts.
     */
    g: z.number().min(-MAX_GRAMS).max(MAX_GRAMS),
    stable: z.boolean(),
    /** From the IR sensors. */
    pos: z.enum(TRUCK_POSITIONS),
  }),
  z.object({ t: z.literal("hb") }),
  /** Repeated while the fault lasts, and sent again after connecting. */
  z.object({ t: z.literal("tamper"), reason: z.enum(TAMPER_REASONS) }),
  /** The wiring is healthy: sent when a fault ends, and after connecting. */
  z.object({ t: z.literal("tamper_clear") }),
]);
export type MainMessage = z.infer<typeof mainMessageSchema>;

/** Backend to the main ESP32. */
export type MainCommand =
  | ({ t: "light" } & Required<Lights>)
  | { t: "buzz"; ms: number; times: number; gap: number }
  | { t: "display"; lines: string[] }
  | { t: "tare" };

export const buzzSchema = z.object({
  ms: z.number().int().min(1).max(10_000),
  times: z.number().int().min(1).max(10),
  gap: z.number().int().min(0).max(2000),
});
export const displayLinesSchema = z
  .array(z.string().max(DISPLAY_LINE_CHARS))
  .min(1)
  .max(DISPLAY_MAX_LINES);
export const lightsSchema = z.object({
  entry: z.enum(LIGHT_STATES),
  exit: z.enum(LIGHT_STATES),
  blink: z.boolean().default(false),
});

/** Returns the message, or undefined if it is not valid JSON of a known shape. */
export function parseMessage<T>(schema: z.ZodType<T>, text: string): T | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}
