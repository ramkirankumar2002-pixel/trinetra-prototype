import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";
import { detectFileType, isAcceptedType } from "./file-type";

const unsupported = () =>
  new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG, PNG or WebP photo, or a PDF.");

export interface Upload {
  buffer: Buffer;
  contentType: string;
}

/**
 * Reads the single file of a multipart request and the form fields beside it, in any
 * order. Files over 8 MB fail with status 413.
 */
export async function readUploadWithFields(
  request: FastifyRequest,
): Promise<{ upload: Upload; fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  let upload: Upload | undefined;
  for await (const part of request.parts()) {
    if (part.type === "field") {
      fields[part.fieldname] = String(part.value);
      continue;
    }
    if (!isAcceptedType(part.mimetype)) throw unsupported();
    const buffer = await part.toBuffer();
    if (detectFileType(buffer) !== part.mimetype) throw unsupported();
    upload = { buffer, contentType: part.mimetype };
  }
  if (!upload) throw new AppError(400, "NO_FILE", "No file was sent.");
  return { upload, fields };
}

/** Reads the single file of a multipart request. */
export async function readUpload(request: FastifyRequest): Promise<Upload> {
  return (await readUploadWithFields(request)).upload;
}
