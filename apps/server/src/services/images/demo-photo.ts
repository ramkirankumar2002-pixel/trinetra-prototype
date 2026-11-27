// The picture that stands in for a camera photo in demo "pick" mode: a drawn truck end
// with the PICKED plate on it, clearly marked as a demo photo. A real camera's photo could
// show another model's plate, and a screen must never show a plate other than the one read.
import { formatPlate, type CameraId } from "@trinetra/shared";
import sharp from "sharp";

const BACK: Record<CameraId, string> = { front: "FRONT", back: "BACK" };

export function demoPlateSvg(plate: string, camera: CameraId): string {
  // Plates are normalised to capital letters and digits, so nothing needs escaping.
  const text = formatPlate(plate).replace(/[^A-Z0-9 ]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"
  font-family="Arial, 'DejaVu Sans', sans-serif" font-weight="bold" text-anchor="middle">
  <rect width="800" height="600" fill="#6b7280"/>
  <rect x="90" y="70" width="620" height="440" rx="24" fill="#1f3a5f"/>
  <rect x="130" y="110" width="540" height="170" rx="12" fill="#2d4f7c"/>
  <circle cx="170" cy="470" r="26" fill="#f97316"/>
  <circle cx="630" cy="470" r="26" fill="#f97316"/>
  <rect x="150" y="340" width="500" height="110" rx="10" fill="#facc15" stroke="#000" stroke-width="5"/>
  <text x="400" y="418" font-size="60" fill="#000">${text}</text>
  <rect x="180" y="150" width="440" height="90" rx="10" fill="#ffffff"/>
  <text x="400" y="212" font-size="52" fill="#7f1d1d">DEMO PHOTO</text>
  <text x="400" y="560" font-size="34" fill="#ffffff">${BACK[camera]} - not from a camera</text>
</svg>`;
}

export function drawDemoPhoto(plate: string, camera: CameraId): Promise<Buffer> {
  return sharp(Buffer.from(demoPlateSvg(plate, camera)))
    .jpeg({ quality: 85 })
    .toBuffer();
}
