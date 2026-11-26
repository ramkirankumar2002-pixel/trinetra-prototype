// The readers as the rest of the backend uses them: real APIs, storage and database lists.
import {
  CAMERA_IDS,
  platesMatch,
  type CameraId,
  type CameraPlateRead,
  type InvoiceRead,
  type PlatesRead,
} from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env";
import type { Database } from "../../db/client";
import { materials, suppliers, transporters } from "../../db/schema";
import type { PhotoService } from "../../hardware/photos";
import type { StorageService } from "../storage";
import { createGemini } from "./gemini";
import { readInvoiceWithGemini, type InvoiceLists } from "./invoice";
import { createPlateReader } from "./plate-reader";
import { createPlateRecognizer } from "./plate-recognizer";
import { createUsageCounter } from "./usage";

export async function loadInvoiceLists(db: Database): Promise<InvoiceLists> {
  const [materialRows, supplierRows, transporterRows] = await Promise.all([
    db.select().from(materials),
    db.select().from(suppliers),
    db.select().from(transporters),
  ]);
  return {
    materials: materialRows,
    suppliers: supplierRows.map((row) => row.name),
    transporters: transporterRows.map((row) => row.name),
  };
}

export interface ReaderDependencies {
  env: Env;
  db: Database;
  storage: StorageService;
  photos: Pick<PhotoService, "requestPhotos">;
  log: FastifyBaseLogger;
  /** Replaced by tests. */
  fetch?: typeof fetch;
}

export function createReaders(deps: ReaderDependencies) {
  const { env, db, storage, photos, log } = deps;
  const usage = createUsageCounter(db, log);
  const network = deps.fetch ? { fetch: deps.fetch } : {};
  const gemini = createGemini({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL,
    usage,
    ...network,
  });
  const readPlate = createPlateReader({
    plateRecognizer: createPlateRecognizer({
      token: env.PLATE_RECOGNIZER_TOKEN,
      usage,
      ...network,
    }),
    gemini,
    log,
  });

  /**
   * Takes a photo with each camera and reads both plates. `ticketId` is null before a
   * ticket exists. Camera and service failures are reported in the answer, not thrown.
   */
  async function readPlates(ticketId: number | null): Promise<PlatesRead> {
    const request = await photos.requestPhotos(ticketId);

    async function readCamera(camera: CameraId): Promise<CameraPlateRead> {
      const photo = request.photos[camera];
      if (!photo) {
        return {
          plate: null,
          source: null,
          confidence: null,
          validFormat: false,
          ms: 0,
          problems: [],
          photoId: null,
          cameraFailure:
            request.failed.find((failure) => failure.camera === camera)?.reason ?? "TIMEOUT",
        };
      }
      const read = await readPlate(await storage.read(photo.storagePath));
      return { ...read, photoId: photo.id, cameraFailure: null };
    }

    const [front, back] = await Promise.all(CAMERA_IDS.map(readCamera));
    const match = platesMatch(front!.plate ?? "", back!.plate ?? "");
    return {
      cameras: { front: front!, back: back! },
      match,
      plate: match && front!.validFormat ? front!.plate : null,
      demo: false,
    };
  }

  /** Reads a processed invoice (JPEG or PDF). Throws a ReaderError if it cannot. */
  async function readInvoice(
    file: { data: Buffer; contentType: string },
    ticketPlate: string | null,
  ): Promise<InvoiceRead> {
    return readInvoiceWithGemini(gemini, file, {
      lists: await loadInvoiceLists(db),
      ticketPlate,
    });
  }

  return { readPlate, readPlates, readInvoice, usage, model: gemini.model };
}

export type Readers = ReturnType<typeof createReaders>;
