import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";
import { detectFileType, isAcceptedType } from "./file-type";

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
  if (!isAcceptedType(file.mimetype)) throw unsupported();

  const buffer = await file.toBuffer();
  if (detectFileType(buffer) !== file.mimetype) throw unsupported();

  return { buffer, contentType: file.mimetype };
}
