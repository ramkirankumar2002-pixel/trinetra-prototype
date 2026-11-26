// What the driver's phone sends: a PDF as it is; any photo (an iPhone's HEIC too, where
// the browser can open it) redrawn as a JPEG of at most 1600 px, so it uploads quickly
// and the backend is sent a type it accepts.

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.85;
export const MAX_BYTES = 8 * 1024 * 1024;

export type PrepareProblem = "BAD_PHOTO" | "BAD_TYPE" | "TOO_BIG";

export class PrepareError extends Error {
  override name = "PrepareError";
  constructor(readonly problem: PrepareProblem) {
    super(problem);
  }
}

/** The size that fits inside `max` × `max`, never larger than the picture itself. */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type FileKind = "pdf" | "photo" | "other";

/** Some phones give a HEIC photo no type at all, so the name counts too. */
export function kindOf(file: { type: string; name: string }): FileKind {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return "pdf";
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    return "photo";
  }
  return "other";
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Opens a picture, turned the way the camera was held. */
async function decode(file: Blob): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bitmap;
    return { source: bitmap, width, height, close: () => bitmap.close() };
  } catch {
    // Safari opens some pictures, HEIC among them, only through an <img>.
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => URL.revokeObjectURL(url),
      };
    } catch {
      URL.revokeObjectURL(url);
      throw new PrepareError("BAD_PHOTO");
    }
  }
}

async function toJpeg(file: Blob): Promise<Blob> {
  const picture = await decode(file);
  try {
    const { width, height } = fitWithin(picture.width, picture.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new PrepareError("BAD_PHOTO");
    // JPEG has no see-through areas: they become white, not black.
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(picture.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new PrepareError("BAD_PHOTO");
    return blob;
  } finally {
    picture.close();
  }
}

export async function prepareFile(file: File): Promise<File> {
  const kind = kindOf(file);
  if (kind === "other") throw new PrepareError("BAD_TYPE");
  const ready =
    kind === "pdf"
      ? new File([file], "invoice.pdf", { type: "application/pdf" })
      : new File([await toJpeg(file)], "invoice.jpg", { type: "image/jpeg" });
  if (ready.size > MAX_BYTES) throw new PrepareError("TOO_BIG");
  return ready;
}
