// What a file really is, from its first bytes: a stated type alone proves nothing.

const hasBytes = (data: Buffer, expected: Buffer, offset = 0) =>
  data.subarray(offset, offset + expected.length).equals(expected);

const FILE_TYPES: Record<string, (data: Buffer) => boolean> = {
  "image/jpeg": (data) => hasBytes(data, Buffer.from([0xff, 0xd8, 0xff])),
  "image/png": (data) =>
    hasBytes(data, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (data) =>
    hasBytes(data, Buffer.from("RIFF")) && hasBytes(data, Buffer.from("WEBP"), 8),
  "application/pdf": (data) => hasBytes(data, Buffer.from("%PDF-")),
};

export const isAcceptedType = (type: string) => Object.hasOwn(FILE_TYPES, type);

/** One of the accepted types (JPEG, PNG, WebP, PDF), or undefined. */
export function detectFileType(data: Buffer): string | undefined {
  return Object.keys(FILE_TYPES).find((type) => FILE_TYPES[type]!(data));
}
