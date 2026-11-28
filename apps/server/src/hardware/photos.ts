// The two ESP32-CAMs. Each one pushes its newest JPEG every second or two
// (POST /api/cam/front or /back). Only the newest frame of each camera is kept, in memory.
// When a photo of the truck is wanted, that frame is saved, if it is fresh enough.
// Nothing is read from a frame until then: the plate services are never asked per frame.
import { CAMERA_IDS, MAX_FRAME_AGE_MS, type CameraId, type PhotoKind } from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import { AppError } from "../errors/app-error";
import { storeFile } from "../services/images/pipeline";
import type { StorageService } from "../services/storage";

/** How long to wait for a new frame from a camera that is online but has no fresh one. */
export const FRAME_WAIT_MS = 4000;

const PHOTO_KIND: Record<CameraId, PhotoKind> = { front: "FRONT_PLATE", back: "BACK_PLATE" };

export interface CameraPhoto {
  id: string;
  storagePath: string;
  sha256: string;
}

export type PhotoFailure =
  /** The camera has sent nothing for a while. */
  | "OFFLINE"
  /** The camera is there, but no fresh frame arrived in time. */
  | "TIMEOUT"
  /** There was a frame, but it could not be saved. */
  | "SAVE_FAILED";

export interface PhotoRequestResult {
  photos: Partial<Record<CameraId, CameraPhoto>>;
  failed: { camera: CameraId; reason: PhotoFailure }[];
}

interface Frame {
  data: Buffer;
  /** When it arrived, on the clock below. */
  at: number;
}

const isJpeg = (data: Buffer) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;

export class PhotoService {
  private readonly latest = new Map<CameraId, Frame>();
  /** Requests waiting for a camera's next frame. */
  private readonly waiting = new Map<CameraId, Set<(frame: Frame | null) => void>>();

  constructor(
    private readonly options: {
      storage: StorageService;
      db: Database;
      log: FastifyBaseLogger;
      isOnline: (camera: CameraId) => boolean;
      /** A clock that never jumps. Replaced by tests. */
      now?: () => number;
      waitMs?: number;
      /** Told as each camera's photo is saved. */
      onSaved?: (camera: CameraId, photo: CameraPhoto) => void;
    },
  ) {}

  private now(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  /** A frame has arrived from a camera. It replaces the one before. */
  addFrame(camera: CameraId, data: Buffer): void {
    if (!isJpeg(data)) throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG photo.");
    const frame = { data, at: this.now() };
    this.latest.set(camera, frame);
    const waiters = this.waiting.get(camera);
    this.waiting.delete(camera);
    waiters?.forEach((resolve) => resolve(frame));
  }

  /** The newest frame, if it is not older than 3 seconds. */
  freshFrame(camera: CameraId): Frame | undefined {
    const frame = this.latest.get(camera);
    return frame && this.now() - frame.at <= MAX_FRAME_AGE_MS ? frame : undefined;
  }

  /**
   * Saves a photo from each camera. `ticketId` is null before a ticket exists (the plate is
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

  /** Ends every waiting request and forgets the frames, for shutdown. */
  stop(): void {
    for (const waiters of this.waiting.values()) waiters.forEach((resolve) => resolve(null));
    this.waiting.clear();
    this.latest.clear();
  }

  private nextFrame(camera: CameraId): Promise<Frame | null> {
    return new Promise((resolve) => {
      const waiters = this.waiting.get(camera) ?? new Set();
      this.waiting.set(camera, waiters);
      const done = (frame: Frame | null) => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(frame);
      };
      const timer = setTimeout(() => done(null), this.options.waitMs ?? FRAME_WAIT_MS);
      waiters.add(done);
    });
  }

  private async capture(
    camera: CameraId,
    ticketId: number | null,
  ): Promise<{ photo: CameraPhoto } | { failure: PhotoFailure }> {
    const { storage, db, log, isOnline, onSaved } = this.options;
    let frame: Frame | null | undefined = this.freshFrame(camera);
    if (!frame) {
      if (!isOnline(camera)) return { failure: "OFFLINE" };
      frame = await this.nextFrame(camera);
      if (!frame) {
        log.warn({ camera }, "no fresh frame from the camera in time");
        return { failure: "TIMEOUT" };
      }
    }
    try {
      const stored = await storeFile(
        { storage, db },
        { data: frame.data, contentType: "image/jpeg", kind: PHOTO_KIND[camera], ticketId },
      );
      const photo = { id: stored.id, storagePath: stored.storagePath, sha256: stored.sha256 };
      onSaved?.(camera, photo);
      return { photo };
    } catch (error) {
      log.error({ camera, err: error }, "could not save a camera frame");
      return { failure: "SAVE_FAILED" };
    }
  }
}
