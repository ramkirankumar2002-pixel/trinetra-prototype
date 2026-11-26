// Draws synthetic plate photos for checking the plate services: pnpm sim:test-plates
// They are NOT a substitute for real ESP32-CAM photos of the model plates (Phase 5B).
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { formatPlate } from "@trinetra/shared";
import sharp, { type Sharp } from "sharp";

const folder = fileURLToPath(new URL("./test-plates/", import.meta.url));
const WIDTH = 1280;
const HEIGHT = 960;

interface Photo {
  file: string;
  plate: string;
  condition: string;
  /** False when part of the plate is hidden: then no full plate may be reported. */
  readable: boolean;
  tilt?: number;
  skew?: number;
  /** Size of the plate: 1 is close up. */
  scale?: number;
  twoLines?: boolean;
  blur?: number;
  /** 1 is daylight. */
  light?: number;
  noise?: number;
  /** Hides the right-hand end of the plate behind a mud flap. */
  covered?: boolean;
}

const PHOTOS: Photo[] = [
  { file: "01-clear.jpg", plate: "MH12AB1234", condition: "clear", readable: true },
  {
    file: "02-tilt-right.jpg",
    plate: "MH14CD5678",
    condition: "tilted 6°",
    readable: true,
    tilt: 6,
  },
  {
    file: "03-tilt-left.jpg",
    plate: "UP32EF9012",
    condition: "tilted -8° and seen from the side",
    readable: true,
    tilt: -8,
    skew: 4,
  },
  { file: "04-blur.jpg", plate: "UP70GH3456", condition: "blurred", readable: true, blur: 2.6 },
  {
    file: "05-dim.jpg",
    plate: "MP09JK7890",
    condition: "dim light",
    readable: true,
    light: 0.32,
    noise: 10,
  },
  {
    file: "06-far.jpg",
    plate: "RJ14LM2345",
    condition: "far away (small plate)",
    readable: true,
    scale: 0.45,
  },
  {
    file: "07-dim-blur.jpg",
    plate: "DL01NP6789",
    condition: "dim, blurred and noisy",
    readable: true,
    light: 0.4,
    blur: 1.6,
    noise: 14,
  },
  {
    file: "08-two-lines.jpg",
    plate: "BR06QR4321",
    condition: "two-line truck plate",
    readable: true,
    twoLines: true,
  },
  {
    file: "09-tilt-blur.jpg",
    plate: "MH12AB1234",
    condition: "tilted, blurred, a little far",
    readable: true,
    tilt: 5,
    blur: 1.4,
    scale: 0.7,
  },
  {
    file: "10-hidden.jpg",
    plate: "MH14CD5678",
    condition: "number (last 4 digits) hidden",
    readable: false,
    covered: true,
  },
];

function drawing(photo: Photo): Buffer {
  const { plate, tilt = 0, skew = 0, scale = 1, twoLines, covered } = photo;
  const parts = formatPlate(plate).split(" ");
  const width = twoLines ? 520 : 760;
  const height = twoLines ? 300 : 175;
  const left = -width / 2;
  const top = -height / 2;
  // The text sits to the right of the blue "IND" strip. The image library ignores SVG's
  // textLength, so the font sizes are chosen to fit.
  const textCentre = (left + 70 + (left + width)) / 2;
  const text = (value: string, y: number, size: number) =>
    `<text x="${textCentre}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="bold" fill="#101010">${value}</text>`;
  const lines = twoLines
    ? text(`${parts[0]} ${parts[1]}`, -22, 98) + text(parts.slice(2).join(" "), 100, 98)
    : text(parts.join(" "), 31, 86);
  // Covers the four digits.
  const flap = covered
    ? `<path d="M ${left + width - 215} ${top - 25} L ${left + width + 40} ${top - 10}
         L ${left + width + 30} ${top + height + 45} L ${left + width - 232} ${top + height + 20} Z" fill="#17181a"/>`
    : "";
  const rivets = [left + 22, left + width - 22]
    .map((x) => `<circle cx="${x}" cy="${top + 22}" r="6" fill="#9ca3af"/>`)
    .join("");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}"
    font-family="Arial, 'DejaVu Sans', sans-serif">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a4b25"/><stop offset="1" stop-color="#4d2a16"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#8f9296"/>
  <rect y="800" width="${WIDTH}" height="160" fill="#55565a"/>
  <rect x="150" y="90" width="980" height="600" rx="18" fill="url(#body)"/>
  ${[230, 330, 430].map((y) => `<rect x="170" y="${y}" width="940" height="14" fill="#3a2012" opacity="0.6"/>`).join("")}
  <rect x="190" y="130" width="270" height="55" fill="#e5e7eb" opacity="0.85"/>
  <text x="325" y="170" text-anchor="middle" font-size="34" font-weight="bold" fill="#7f1d1d">GOODS CARRIER</text>
  <rect x="110" y="690" width="1060" height="60" fill="#26272b"/>
  <circle cx="215" cy="650" r="30" fill="#b91c1c"/><circle cx="1065" cy="650" r="30" fill="#b91c1c"/>
  <rect x="190" y="750" width="150" height="150" rx="40" fill="#111214"/>
  <rect x="940" y="750" width="150" height="150" rx="40" fill="#111214"/>
  <g transform="translate(640 590) scale(${scale}) rotate(${tilt}) skewY(${skew})">
    <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="14" fill="#f5f5f2" stroke="#111" stroke-width="7"/>
    <rect x="${left + 10}" y="${top + 10}" width="58" height="${height - 20}" fill="#1d4ed8"/>
    <circle cx="${left + 39}" cy="${top + height / 2 - 18}" r="16" fill="none" stroke="#e5e7eb" stroke-width="4"/>
    <text x="${left + 39}" y="${top + height / 2 + 42}" text-anchor="middle" font-size="24" font-weight="bold" fill="#fff">IND</text>
    ${rivets}
    ${lines}
    ${flap}
  </g>
</svg>`);
}

async function render(photo: Photo): Promise<Sharp> {
  let image = sharp(await sharp(drawing(photo)).png().toBuffer());
  if (photo.noise) {
    // Grain, like a small camera sensor in poor light.
    const grain = await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: photo.noise * 2 },
      },
    })
      .png()
      .toBuffer();
    image = sharp(
      await image
        .composite([{ input: grain, blend: "soft-light" }])
        .png()
        .toBuffer(),
    );
  }
  if (photo.light) image = image.linear(photo.light, 0);
  if (photo.blur) image = image.blur(photo.blur);
  return image;
}

await mkdir(folder, { recursive: true });
for (const photo of PHOTOS) {
  await (await render(photo)).jpeg({ quality: 82 }).toFile(`${folder}${photo.file}`);
  console.log(`${photo.file}: ${formatPlate(photo.plate)} (${photo.condition})`);
}
await writeFile(
  `${folder}manifest.json`,
  `${JSON.stringify(
    PHOTOS.map(({ file, plate, condition, readable }) => ({ file, plate, condition, readable })),
    null,
    2,
  )}\n`,
);
