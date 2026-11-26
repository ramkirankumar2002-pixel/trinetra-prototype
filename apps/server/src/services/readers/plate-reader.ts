// Reads one number plate: Plate Recognizer first, then Gemini on the same photo.
import {
  isValidIndianPlate,
  normalizePlate,
  type PlateRead,
  type ReadProblem,
} from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import { PLATE_READ_DEADLINE_MS } from "../../config/limits";
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

export async function readPlateWithGemini(
  gemini: Gemini,
  jpeg: Buffer,
): Promise<{ plate: string | null; model: string }> {
  const { data: answer, model } = await gemini.generateJson({
    parts: [filePart(jpeg, "image/jpeg"), { type: "text", text: PLATE_PROMPT }],
    schema: plateJsonSchema,
    validate: z.object({ plate: z.string().nullable() }),
  });
  const plate = answer.plate === null ? "" : normalizePlate(answer.plate);
  // Anything that is not a whole plate counts as unread.
  return { plate: isValidIndianPlate(plate) ? plate : null, model };
}

export function createPlateReader(deps: {
  plateRecognizer: PlateRecognizer;
  gemini: Gemini;
  log: Pick<FastifyBaseLogger, "warn">;
  /** The longest the whole reading may take. */
  deadlineMs?: number;
}) {
  const { deadlineMs = PLATE_READ_DEADLINE_MS } = deps;

  async function readWithBothServices(
    jpeg: Buffer,
    problems: PlateRead["problems"],
    asking: (service: ReadProblem["service"]) => void,
  ): Promise<PlateRead> {
    const started = performance.now();
    const done = (
      plate: string | null,
      source: PlateRead["source"],
      confidence: number | null,
      model: string | null = null,
    ): PlateRead => ({
      plate,
      source,
      model,
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
      asking("plate_recognizer");
      const guess = await deps.plateRecognizer.read(jpeg);
      if (guess.plate) return done(guess.plate, "plate_recognizer", guess.score);
    } catch (error) {
      note(error);
    }
    // No plate found (or the service failed): ask Gemini to read the same photo.
    try {
      asking("gemini");
      const { plate, model } = await readPlateWithGemini(deps.gemini, jpeg);
      // Gemini gives no confidence number.
      return done(plate, "gemini", null, model);
    } catch (error) {
      note(error);
    }
    return done(null, null, null);
  }

  /**
   * Never throws for a service problem: see `problems` in the answer. A reading that takes
   * longer than the deadline counts as unread, so the person waiting is not left waiting.
   */
  return async function readPlate(jpeg: Buffer): Promise<PlateRead> {
    const problems: PlateRead["problems"] = [];
    let service: ReadProblem["service"] = "plate_recognizer";
    const reading = readWithBothServices(jpeg, problems, (name) => (service = name));
    let timer: NodeJS.Timeout | undefined;
    const tooLate = new Promise<PlateRead>((resolve) => {
      timer = setTimeout(() => {
        deps.log.warn({ service, deadlineMs }, "reader: the plate took too long");
        resolve({
          plate: null,
          source: null,
          model: null,
          confidence: null,
          validFormat: false,
          ms: deadlineMs,
          problems: [...problems, { service, code: "TIMEOUT" }],
        });
      }, deadlineMs);
    });
    try {
      return await Promise.race([reading, tooLate]);
    } finally {
      clearTimeout(timer);
      // The late answer is not wanted, and neither is its failure.
      reading.catch(() => {});
    }
  };
}

export type ReadPlate = ReturnType<typeof createPlateReader>;
