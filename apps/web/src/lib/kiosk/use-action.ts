// One press at a time: buttons are disabled while a request runs. Every press gets its own
// Idempotency-Key, and pressing again after a lost answer sends the same key, so one press
// can never act twice.
import { useCallback, useRef, useState } from "react";
import { ApiError, newIdempotencyKey } from "../api";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export function createPresses(newKey: () => string = newIdempotencyKey) {
  /** The keys of presses whose answer may have been lost. */
  const unanswered = new Map<string, string>();
  let running = false;

  /**
   * `name` says what the press does, values included: the same name after a failure is
   * the same press. Null if another press is still running.
   */
  return async function press<T>(
    name: string,
    work: (idempotencyKey: string) => Promise<T>,
  ): Promise<ActionResult<T> | null> {
    if (running) return null;
    running = true;
    const key = unanswered.get(name) ?? newKey();
    unanswered.set(name, key);
    try {
      const data = await work(key);
      unanswered.delete(name);
      return { ok: true, data };
    } catch (error) {
      const known =
        error instanceof ApiError ? error : new ApiError(0, "UNKNOWN", (error as Error).message);
      // A refusal is final: pressing again is a new press.
      if (!known.retryable) unanswered.delete(name);
      return { ok: false, error: known };
    } finally {
      running = false;
    }
  };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const presses = useRef<ReturnType<typeof createPresses> | null>(null);

  const run = useCallback(async <T>(name: string, work: (key: string) => Promise<T>) => {
    presses.current ??= createPresses();
    const pending = presses.current(name, work);
    setBusy(true);
    const result = await pending;
    if (result !== null) setBusy(false);
    return result;
  }, []);

  return { busy, run };
}
