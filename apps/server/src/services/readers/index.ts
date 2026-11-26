// The readers as the rest of the backend uses them: real APIs, storage and database lists.
import {
  CAMERA_IDS,
  normalizePlate,
  platesMatch,
  type CameraId,
  type CameraPlateRead,
  type InvoiceRead,
  type PlateRead,
  type PlatesRead,
} from "@trinetra/shared";
import { SAMPLE_INVOICES } from "@trinetra/shared/seed";
import { eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Env } from "../../config/env";
import type { Database } from "../../db/client";
import { materials, suppliers, transporters, vehicles } from "../../db/schema";
import { AppError } from "../../errors/app-error";
import type { PhotoService } from "../../hardware/photos";
import type { StorageService } from "../storage";
import { createGemini } from "./gemini";
import { interpretInvoice, readInvoiceWithGemini, type InvoiceLists } from "./invoice";
import { loadReaderModes, type ReaderModes } from "./modes";
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
    fallbackModel: env.GEMINI_FALLBACK_MODEL,
    usage,
    log,
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

  const badDemoSetting = (message: string) => new AppError(409, "DEMO_SETTING_INVALID", message);

  /** "pick" mode: the chosen plate from the vehicle list stands in for both cameras. */
  async function pickedPlates(modes: ReaderModes): Promise<PlatesRead> {
    const plate = normalizePlate(modes.demo_plate ?? "");
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.plate, plate));
    if (!vehicle) throw badDemoSetting("demo_plate is not a plate from the vehicle list.");
    const camera: CameraPlateRead = {
      plate,
      source: "demo",
      model: null,
      confidence: null,
      validFormat: true,
      ms: 0,
      problems: [],
      photoId: null,
      cameraFailure: null,
    };
    return { cameras: { front: camera, back: camera }, match: true, plate, demo: true };
  }

  /**
   * Takes a photo with each camera and reads both plates. `ticketId` is null before a
   * ticket exists. Camera and service failures are reported in the answer, not thrown.
   */
  async function readPlates(ticketId: number | null): Promise<PlatesRead> {
    const modes = await loadReaderModes(db);
    if (modes.anpr_mode === "pick") return pickedPlates(modes);
    const request = await photos.requestPhotos(ticketId);

    async function readCamera(camera: CameraId): Promise<CameraPlateRead> {
      const photo = request.photos[camera];
      if (!photo) {
        return {
          plate: null,
          source: null,
          model: null,
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

  /**
   * Reads a processed invoice (JPEG or PDF). Throws a ReaderError if Gemini cannot be used.
   * In "pick" mode the chosen sample invoice is returned and the file is not needed.
   */
  async function readInvoice(
    file: { data: Buffer; contentType: string } | null,
    ticketPlate: string | null,
  ): Promise<InvoiceRead> {
    const modes = await loadReaderModes(db);
    const lists = await loadInvoiceLists(db);

    if (modes.ocr_mode === "pick") {
      const sample = SAMPLE_INVOICES.find((invoice) => invoice.id === modes.demo_invoice);
      if (!sample) throw badDemoSetting("demo_invoice does not name a sample invoice.");
      return interpretInvoice(sample.printed, { lists, ticketPlate, source: "demo", ms: 0 });
    }
    if (!file) throw new AppError(400, "NO_FILE", "No invoice file was sent.");
    return readInvoiceWithGemini(gemini, file, { lists, ticketPlate });
  }

  /** Reads the supervisor's live photo. In "pick" mode it shows the chosen demo plate. */
  async function readSupervisorPlate(jpeg: Buffer): Promise<PlateRead> {
    const modes = await loadReaderModes(db);
    if (modes.anpr_mode !== "pick") return readPlate(jpeg);
    const { front } = (await pickedPlates(modes)).cameras;
    const { plate, source, model, confidence, validFormat, ms, problems } = front;
    return { plate, source, model, confidence, validFormat, ms, problems };
  }

  return { readPlate, readPlates, readSupervisorPlate, readInvoice, usage, model: gemini.model };
}

export type Readers = ReturnType<typeof createReaders>;
