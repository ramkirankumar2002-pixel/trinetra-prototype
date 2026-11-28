import type { HardwareState } from "./state";

const CHECK_EVERY_MS = 50;

/**
 * Waits until the truck on the bridge stands still (the weight could be captured), for at
 * most `maxMs`. It gives up at once for any other problem, such as no truck at all: the
 * caller carries on either way.
 */
export async function waitUntilStill(state: HardwareState, maxMs: number): Promise<void> {
  const deadline = performance.now() + maxMs;
  while (state.canCapture().reason === "NOT_STABLE" && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_EVERY_MS));
  }
}
