// Asking the two ESP32-CAMs for plate photos and receiving them (build plan section 7).
import { randomUUID } from "node:crypto";
import { CAMERA_IDS, type CameraId, type PhotoKind } from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import { AppError } from "../errors/app-error";
import { storeFile } from "../services/images/pipeline";
import type { StorageService } from "../services/storage";
import type { DeviceHub } from "./hub";

export const PHOTO_TIMEOUT_MS = 5000;
/** The first request, then "asks once more". */
const ATTEMPTS = 2;

const PHOTO_KIND: Record<CameraId, PhotoKind> = { front: "FRONT_PLATE", back: "BACK_PLATE" };

export interface CameraPhoto {
  id: string;
  storagePath: string;
  sha256: string;
}

export type PhotoFailure =
  /** The camera is not connected. */
  | "OFFLINE"
  /** No photo arrived, even after asking again. */
  | "TIMEOUT"
  /** The photo arrived but could not be saved. */
  | "SAVE_FAILED";

export interface PhotoRequestResult {
  photos: Partial<Record<CameraId, CameraPhoto>>;
  failed: { camera: CameraId; reason: PhotoFailure }[];
}

interface Pending {
  camera: CameraId;
  ticketId: number | null;
  /** An upload has arrived and is being saved. */
  claimed: boolean;
  /** Settles with the saved photo, or null if saving it failed. */
  result: Promise<CameraPhoto | null>;
  settle: (photo: CameraPhoto | null) => void;
}

const isJpeg = (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;

export class PhotoService {
  /** Photo ids that may still be uploaded. Each works once, for one camera. */
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly options: {
      hub: DeviceHub;
      storage: StorageService;
      db: Database;
      log: FastifyBaseLogger;
      timeoutMs?: number;
      /** Told as each camera's photo is saved. */
      onSaved?: (camera: CameraId, photo: CameraPhoto) => void;
    },
  ) {}

  /**
   * Asks both cameras for a photo. `ticketId` is null before a ticket exists (the plate is
   * read first). Never throws for a camera problem: see `failed` in the answer.
   */
  async requestPhotos(ticketId: number | null): Promise<PhotoRequestResult> {
    const outcomes = await Promise.all(
      CAMERA_IDS.map(async (camera) => ({ camera, ...(await this.capture(camera, ticketId)) })),
    );
    const result: PhotoRequestResult = { photos: {}, failed: [] };
    for (const outcome of outcomes) {
      if ("photo" in outcome) result.photos[outcome.camera] = outcome.photo;
      else result.failed.push({ camera: outcome.camera, reason: outcome.failure });
    }
    return result;
  }

  /** Saves a photo a camera uploaded, if the id was sent to that camera and is unused. */
  async receive(camera: CameraId, photoId: string, data: Buffer): Promise<CameraPhoto> {
    const pending = this.pending.get(photoId);
    if (!pending || pending.claimed) {
      // The same answer for unknown, used and expired ids.
      throw new AppError(404, "UNKNOWN_PHOTO_ID", "This photo id cannot be used.");
    }
    if (pending.camera !== camera) {
      throw new AppError(403, "WRONG_CAMERA", "This photo id was sent to the other camera.");
    }
    if (!isJpeg(data)) {
      // Not claimed, so the camera may send a good photo.
      throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG photo.");
    }
    // No await before this line: two uploads cannot both get here.
    pending.claimed = true;

    try {
      const { storage, db } = this.options;
      const stored = await storeFile(
        { storage, db },
        {
          data,
          contentType: "image/jpeg",
          kind: PHOTO_KIND[camera],
          ticketId: pending.ticketId,
          id: photoId,
        },
      );
      const photo = { id: photoId, storagePath: stored.storagePath, sha256: stored.sha256 };
      pending.settle(photo);
      this.options.onSaved?.(camera, photo);
      return photo;
    } catch (error) {
      pending.settle(null);
      throw error;
    } finally {
      this.pending.delete(photoId);
    }
  }

  /** Ends every waiting request, for shutdown. */
  stop(): void {
    for (const pending of this.pending.values()) pending.settle(null);
    this.pending.clear();
  }

  private async capture(
    camera: CameraId,
    ticketId: number | null,
  ): Promise<{ photo: CameraPhoto } | { failure: PhotoFailure }> {
    const { hub, log, timeoutMs = PHOTO_TIMEOUT_MS } = this.options;
    // The same id is used again on the retry, so a slow first photo still counts.
    const id = randomUUID();
    let settle!: Pending["settle"];
    const result = new Promise<CameraPhoto | null>((resolve) => (settle = resolve));
    const pending: Pending = { camera, ticketId, claimed: false, result, settle };
    this.pending.set(id, pending);

    try {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        if (!hub.send(camera, { t: "snap", id })) return { failure: "OFFLINE" };

        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        });
        let outcome = await Promise.race([result, timeout]);
        clearTimeout(timer);
        // The photo is here and being saved: wait for that instead of asking again.
        if (outcome === "timeout" && pending.claimed) outcome = await result;

        if (outcome !== "timeout") {
          return outcome ? { photo: outcome } : { failure: "SAVE_FAILED" };
        }
        log.warn({ camera, attempt }, "no photo from the camera in time");
      }
      return { failure: "TIMEOUT" };
    } finally {
      // After this the id is refused, even if the photo turns up later.
      if (!pending.claimed) this.pending.delete(id);
    }
  }
}
