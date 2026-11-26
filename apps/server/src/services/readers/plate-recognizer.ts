// Plate Recognizer Snapshot Cloud API: https://api.platerecognizer.com/v1/api-reference/
import { isValidIndianPlate, normalizePlate } from "@trinetra/shared";
import { z } from "zod";
import { ReaderError } from "./errors";
import type { UsageCounter } from "./usage";

const ENDPOINT = "https://api.platerecognizer.com/v1/plate-reader/";
const REGION = "in";
export const PLATE_TIMEOUT_MS = 8000;
/** The free plan allows 1 lookup a second, and a truck sends two photos at once. */
export const MIN_INTERVAL_MS = 1100;

const answerSchema = z.object({
  results: z.array(
    z.object({ plate: z.string(), score: z.number(), dscore: z.number().optional() }),
  ),
});

export interface PlateGuess {
  /** Normalised, or null when no plate was found. */
  plate: string | null;
  /** How sure the service is of the characters, 0 to 1. */
  score: number | null;
}

export interface PlateRecognizerOptions {
  token: string | undefined;
  usage: UsageCounter;
  fetch?: typeof fetch;
  timeoutMs?: number;
  minIntervalMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPlateRecognizer(options: PlateRecognizerOptions) {
  const { token, usage, timeoutMs = PLATE_TIMEOUT_MS } = options;
  const minIntervalMs = options.minIntervalMs ?? MIN_INTERVAL_MS;
  const fail = (code: ReaderError["code"], message: string) =>
    new ReaderError("plate_recognizer", code, message);

  let turn: Promise<void> = Promise.resolve();
  let nextStartAt = 0;
  /** Waits until another request may start, so starts are spaced out. */
  function waitForTurn(): Promise<void> {
    turn = turn.then(async () => {
      const wait = nextStartAt - Date.now();
      if (wait > 0) await sleep(wait);
      nextStartAt = Date.now() + minIntervalMs;
    });
    return turn;
  }

  async function send(jpeg: Buffer): Promise<Response> {
    const form = new FormData();
    form.append("upload", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "plate.jpg");
    form.append("regions", REGION);
    await waitForTurn();
    await usage.record("plate_recognizer");
    try {
      return await (options.fetch ?? fetch)(ENDPOINT, {
        method: "POST",
        headers: { authorization: `Token ${token}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // The original error is left out: only its kind is useful, and it is safe.
      throw (error as Error).name === "TimeoutError"
        ? fail("TIMEOUT", `no answer within ${timeoutMs} ms`)
        : fail("NETWORK", "could not reach the service");
    }
  }

  async function attempt(jpeg: Buffer): Promise<PlateGuess> {
    const response = await send(jpeg);
    if (response.status === 429) throw fail("RATE_LIMITED", "too many requests");
    if (response.status === 403 || response.status === 401) {
      throw fail("AUTH_OR_CREDITS", "the token was refused, or no credits are left");
    }
    if (response.status >= 500) throw fail("BUSY", `HTTP ${response.status}`);
    if (!response.ok) throw fail("REQUEST_REFUSED", `HTTP ${response.status}`);

    const body = answerSchema.safeParse(await response.json().catch(() => undefined));
    if (!body.success) throw fail("BAD_ANSWER", "unexpected answer");

    // A result shaped like an Indian plate beats one that is not; then the higher score.
    const best = body.data.results
      .map(({ plate, score }) => ({ plate: normalizePlate(plate), score }))
      .filter(({ plate }) => plate !== "")
      .sort(
        (a, b) =>
          Number(isValidIndianPlate(b.plate)) - Number(isValidIndianPlate(a.plate)) ||
          b.score - a.score,
      )[0];
    return best ?? { plate: null, score: null };
  }

  return {
    async read(jpeg: Buffer): Promise<PlateGuess> {
      if (!token) throw fail("NOT_CONFIGURED", "PLATE_RECOGNIZER_TOKEN is not set");
      try {
        return await attempt(jpeg);
      } catch (error) {
        // One more try for a network problem, or if we asked too soon.
        const retry =
          error instanceof ReaderError &&
          ["NETWORK", "TIMEOUT", "RATE_LIMITED"].includes(error.code);
        if (!retry) throw error;
        return attempt(jpeg);
      }
    },
  };
}

export type PlateRecognizer = ReturnType<typeof createPlateRecognizer>;
