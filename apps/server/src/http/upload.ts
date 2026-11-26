import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";

const hasBytes = (data: Buffer, bytes: number[] | string, offset = 0) => {
  const expected = Buffer.from(bytes as string);
  return data.subarray(offset, offset + expected.length).equals(expected);
};

/** Accepted types, each with a check of the first bytes: the stated type alone proves nothing. */
const FILE_TYPES: Record<string, (data: Buffer) => boolean> = {
  "image/jpeg": (data) => data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
  "image/png": (data) =>
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (data) => hasBytes(data, "RIFF") && hasBytes(data, "WEBP", 8),
  "application/pdf": (data) => hasBytes(data, "%PDF-"),
};

const unsupported = () =>
  new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG, PNG or WebP photo, or a PDF.");

export interface Upload {
  buffer: Buffer;
  contentType: string;
}

/** Reads the single file of a multipart request. Files over 8 MB fail with status 413. */
export async function readUpload(request: FastifyRequest): Promise<Upload> {
  const file = await request.file();
  if (!file) throw new AppError(400, "NO_FILE", "No file was sent.");
  if (!Object.hasOwn(FILE_TYPES, file.mimetype)) throw unsupported();

  const buffer = await file.toBuffer();
  if (!FILE_TYPES[file.mimetype]!(buffer)) throw unsupported();

  return { buffer, contentType: file.mimetype };
}
