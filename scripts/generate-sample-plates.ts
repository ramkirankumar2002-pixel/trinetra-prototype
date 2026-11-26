// Draws the sample truck photos the simulated cameras upload: pnpm sim:plates
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatPlate } from "@trinetra/shared";
import sharp from "sharp";

const folder = fileURLToPath(new URL("./sample-plates/", import.meta.url));

/** A plain truck end with a large yellow (commercial) number plate. */
function drawing(plate: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
  <rect width="800" height="600" fill="#6b7280"/>
  <rect x="90" y="70" width="620" height="440" rx="24" fill="#1f3a5f"/>
  <rect x="130" y="110" width="540" height="170" rx="12" fill="#2d4f7c"/>
  <circle cx="170" cy="470" r="26" fill="#f97316"/>
  <circle cx="630" cy="470" r="26" fill="#f97316"/>
  <rect x="150" y="340" width="500" height="110" rx="10" fill="#facc15" stroke="#000" stroke-width="5"/>
  <text x="400" y="418" text-anchor="middle" textLength="450" lengthAdjust="spacingAndGlyphs"
        font-family="Arial, 'DejaVu Sans', sans-serif" font-size="64" font-weight="bold"
        fill="#000">${formatPlate(plate)}</text>
</svg>`);
}

const PHOTOS: [file: string, plate: string][] = [
  ["match-front.jpg", "MH12AB1234"],
  ["match-back.jpg", "MH12AB1234"],
  // The mismatched pair: the back shows another truck's plate.
  ["mismatch-front.jpg", "MH12AB1234"],
  ["mismatch-back.jpg", "MH14CD5678"],
];

await mkdir(folder, { recursive: true });
for (const [file, plate] of PHOTOS) {
  await sharp(drawing(plate)).jpeg({ quality: 85 }).toFile(`${folder}${file}`);
  console.log(`${file}: ${formatPlate(plate)}`);
}
