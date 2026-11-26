// Checks both drivers apply, so a path that works locally also works in the cloud.
import { createHash } from "node:crypto";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Each part starts with a letter or digit, so "..", hidden files and absolute paths fail. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

export function contentTypeOf(path: string): string {
  const segments = path.split("/");
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const type = Object.hasOwn(CONTENT_TYPES, extension) ? CONTENT_TYPES[extension] : undefined;
  if (path.length > 200 || !segments.every((part) => SEGMENT.test(part)) || !type) {
    throw new Error(`Unsafe or unsupported storage path: ${JSON.stringify(path)}`);
  }
  return type;
}

export function assertMatchingType(path: string, contentType: string): void {
  if (contentTypeOf(path) !== contentType) {
    throw new Error(`The file extension of "${path}" does not match the type ${contentType}.`);
  }
}

export function assertExpiry(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
    throw new Error("A file link must expire within 1 to 3600 seconds.");
  }
}

export const sha256Of = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
