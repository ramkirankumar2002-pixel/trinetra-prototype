// What the plate and invoice readers return (build plan sections 4, 6 and 8).
import type { CameraId } from "./hardware";

/** Where a reading came from. "demo" means it was picked in demo mode, not read. */
export type ReadSource = "plate_recognizer" | "gemini" | "demo";

export interface ReadProblem {
  service: "plate_recognizer" | "gemini";
  code: string;
}

export interface PlateRead {
  /** Normalised, or null if no plate could be read. */
  plate: string | null;
  /** Null if neither service gave an answer. */
  source: ReadSource | null;
  /** 0 to 1 from Plate Recognizer; Gemini gives none. */
  confidence: number | null;
  /** True if the text has the shape of an Indian plate. */
  validFormat: boolean;
  ms: number;
  /** Services that failed along the way (a fallback may still have succeeded). */
  problems: ReadProblem[];
}

export interface CameraPlateRead extends PlateRead {
  /** The stored photo, or null if none arrived. */
  photoId: string | null;
  /** Why no photo arrived. */
  cameraFailure: "OFFLINE" | "TIMEOUT" | "SAVE_FAILED" | null;
}

export interface PlatesRead {
  cameras: Record<CameraId, CameraPlateRead>;
  /** True only if both cameras read the same plate. */
  match: boolean;
  /** The plate both agree on, otherwise null. */
  plate: string | null;
  demo: boolean;
}

export interface MatchedValue {
  /** As written on the invoice. */
  raw: string | null;
  /** The name in our list that it means, or null if it matches none or several. */
  matched: string | null;
}

export interface InvoiceWarning {
  code: "VEHICLE_MISMATCH" | "WEIGHT_UNIT_UNKNOWN" | "MATERIAL_NOT_RECOGNISED";
  message: string;
}

export interface InvoiceRead {
  invoiceNo: string | null;
  /** YYYY-MM-DD */
  invoiceDate: string | null;
  supplier: MatchedValue;
  transporter: MatchedValue;
  material: MatchedValue;
  vehicle: { raw: string | null; plate: string | null };
  quantity: { value: number | null; unit: string | null };
  /** Whole kilograms, or null if the invoice gives no weight we can convert. */
  weightKg: number | null;
  warnings: InvoiceWarning[];
  source: "gemini" | "demo";
  ms: number;
}
