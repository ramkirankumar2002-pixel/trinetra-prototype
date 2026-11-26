// Messages on the /device WebSocket (build plan section 7). Everything from a device is
// checked here; anything else is ignored. A camera cannot send a weight: it has its own schema.
import { CAMERA_IDS, LIGHT_COLOURS, type CameraId, type LightColour } from "@trinetra/shared";
import { z } from "zod";

/** Far above any real truck: a reading outside this is a fault, not a weight. */
const MAX_KG = 200_000;

const heartbeat = z.object({ t: z.literal("hb") });

export const mainMessageSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("w"),
    // Slightly below zero is normal when the empty bridge drifts.
    kg: z.number().min(-MAX_KG).max(MAX_KG),
    stable: z.boolean(),
    pos: z.boolean(),
  }),
  heartbeat,
]);
export type MainMessage = z.infer<typeof mainMessageSchema>;

export const cameraMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), cam: z.enum(CAMERA_IDS) }),
  heartbeat,
]);
export type CameraMessage = z.infer<typeof cameraMessageSchema>;

/** Backend to the main ESP32. */
export type MainCommand =
  | { t: "light"; c: LightColour }
  | { t: "buzz"; ms: number }
  | { t: "display"; text: string }
  | { t: "tare" };

/** Backend to a camera. */
export interface SnapCommand {
  t: "snap";
  id: string;
}

export const buzzMsSchema = z.number().int().min(1).max(10_000);
export const displayTextSchema = z.string().min(1).max(80);
export const lightColourSchema: z.ZodType<LightColour> = z.enum(LIGHT_COLOURS);
export type { CameraId };

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
