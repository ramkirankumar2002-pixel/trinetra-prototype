// Reads one number plate: Plate Recognizer first, then Gemini on the same photo.
import { isValidIndianPlate, normalizePlate, type PlateRead } from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { ReaderError } from "./errors";
import { filePart, type Gemini } from "./gemini";
import type { PlateRecognizer } from "./plate-recognizer";

const PLATE_PROMPT = [
  "This is a photo of the front or back of a truck in India.",
  "Read the vehicle registration number on its number plate.",
  "Report only characters you can actually see. If any part of the number is hidden,",
  "cut off, or too unclear to read with certainty, return null. Never guess, complete",
  'or correct a number. Do not include the word "IND" from the plate\'s blue strip.',
].join(" ");

const plateJsonSchema = {
  type: "object",
  properties: { plate: { type: ["string", "null"] } },
  required: ["plate"],
};

export async function readPlateWithGemini(gemini: Gemini, jpeg: Buffer): Promise<string | null> {
  const answer = await gemini.generateJson({
    parts: [filePart(jpeg, "image/jpeg"), { type: "text", text: PLATE_PROMPT }],
    schema: plateJsonSchema,
    validate: z.object({ plate: z.string().nullable() }),
  });
  const plate = answer.plate === null ? "" : normalizePlate(answer.plate);
  // Anything that is not a whole plate counts as unread.
  return isValidIndianPlate(plate) ? plate : null;
}

export function createPlateReader(deps: {
  plateRecognizer: PlateRecognizer;
  gemini: Gemini;
  log: Pick<FastifyBaseLogger, "warn">;
}) {
  /** Never throws for a service problem: see `problems` in the answer. */
  return async function readPlate(jpeg: Buffer): Promise<PlateRead> {
    const started = performance.now();
    const problems: PlateRead["problems"] = [];
    const done = (
      plate: string | null,
      source: PlateRead["source"],
      confidence: number | null,
    ): PlateRead => ({
      plate,
      source,
      confidence,
      validFormat: plate !== null && isValidIndianPlate(plate),
      ms: Math.round(performance.now() - started),
      problems,
    });
    const note = (error: unknown) => {
      if (!(error instanceof ReaderError)) throw error;
      deps.log.warn({ service: error.service, code: error.code, detail: error.message }, "reader");
      problems.push({ service: error.service, code: error.code });
    };

    try {
      const guess = await deps.plateRecognizer.read(jpeg);
      if (guess.plate) return done(guess.plate, "plate_recognizer", guess.score);
    } catch (error) {
      note(error);
    }
    // No plate found (or the service failed): ask Gemini to read the same photo.
    try {
      const plate = await readPlateWithGemini(deps.gemini, jpeg);
      // Gemini gives no confidence number.
      return done(plate, "gemini", null);
    } catch (error) {
      note(error);
    }
    return done(null, null, null);
  };
}

export type ReadPlate = ReturnType<typeof createPlateReader>;
