import { createHash, timingSafeEqual } from "node:crypto";
import { DEVICE_IDS, type DeviceId } from "@trinetra/shared";
import type { Env } from "../config/env";

export const DEVICE_TOKEN_HEADER = "x-device-token";

/** The environment variable that holds each device's secret. */
export const DEVICE_TOKEN_VARIABLES = {
  main: "DEVICE_TOKEN",
  front: "CAM_FRONT_TOKEN",
  back: "CAM_BACK_TOKEN",
} as const satisfies Record<DeviceId, keyof Env>;

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Which device this token belongs to. A device whose token is not set can never connect.
 * Hashes are compared in constant time, so timing reveals nothing about a token.
 */
export function identifyDevice(env: Env, header: unknown): DeviceId | undefined {
  if (typeof header !== "string" || header === "") return undefined;
  const given = digest(header);
  return DEVICE_IDS.find((device) => {
    const token = env[DEVICE_TOKEN_VARIABLES[device]];
    return token !== undefined && timingSafeEqual(given, digest(token));
  });
}
