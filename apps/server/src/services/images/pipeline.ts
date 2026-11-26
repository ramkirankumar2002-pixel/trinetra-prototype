// Every photo or invoice goes through here before it is read or stored (build plan step 56).
import { randomUUID } from "node:crypto";
import type { PhotoKind } from "@trinetra/shared";
import sharp from "sharp";
import { MAX_UPLOAD_BYTES } from "../../config/limits";
import type { Database } from "../../db/client";
import { photos } from "../../db/schema";
import { AppError } from "../../errors/app-error";
import { detectFileType } from "../../http/file-type";
import type { StorageService } from "../storage";

export const MAX_IMAGE_WIDTH = 1600;
export const JPEG_QUALITY = 85;
/** About 50 megapixels: a small file must not unpack into gigabytes of memory. */
const MAX_PIXELS = 50_000_000;

export interface ProcessedFile {
  data: Buffer;
  contentType: "image/jpeg" | "application/pdf";
}

const unsupported = () =>
  new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG, PNG or WebP photo, or a PDF.");

/**
 * Images come out as an upright JPEG at most 1600 px wide, without their hidden data
 * (camera details, GPS position). PDFs are returned unchanged.
 * `statedType` is what the sender says it is; the content must agree.
 */
export async function processFile(input: Buffer, statedType: string): Promise<ProcessedFile> {
  if (input.length > MAX_UPLOAD_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "The file is larger than 8 MB.");
  }
  const type = detectFileType(input);
  if (!type || type !== statedType) throw unsupported();
  if (type === "application/pdf") return { data: input, contentType: type };

  try {
    const data = await sharp(input, { limitInputPixels: MAX_PIXELS })
      // Turns the picture the way the camera says it was held (EXIF), before resizing.
      .autoOrient()
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      // JPEG has no transparency: see-through areas become white, not black.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { data, contentType: "image/jpeg" };
  } catch {
    throw new AppError(415, "INVALID_IMAGE", "The picture is damaged or too large to open.");
  }
}

export interface StoredFile extends ProcessedFile {
  id: string;
  storagePath: string;
  /** Of the saved bytes. */
  sha256: string;
}

/** "20261126": groups stored files by day. */
const dayFolder = (date: Date) => date.toISOString().slice(0, 10).replaceAll("-", "");

/** Processes a file, saves it and records it in the photos table. */
export async function storeFile(
  deps: { storage: StorageService; db: Database },
  file: {
    data: Buffer;
    contentType: string;
    kind: PhotoKind;
    ticketId: number | null;
    id?: string;
  },
): Promise<StoredFile> {
  const processed = await processFile(file.data, file.contentType);
  const id = file.id ?? randomUUID();
  const extension = processed.contentType === "application/pdf" ? "pdf" : "jpg";
  const saved = await deps.storage.save(
    processed.data,
    `photos/${dayFolder(new Date())}/${id}.${extension}`,
    processed.contentType,
  );
  await deps.db.insert(photos).values({
    id,
    ticketId: file.ticketId,
    kind: file.kind,
    storagePath: saved.path,
    sha256: saved.sha256,
  });
  return { ...processed, id, storagePath: saved.path, sha256: saved.sha256 };
}
