// Makes the screenshots in a folder much smaller (256 colours), so they can be committed.
//   tsx compress-screenshots.ts ../docs/screenshots/phase10
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";

const folder = resolve(process.argv[2] ?? "");
let before = 0;
let after = 0;
for (const name of await readdir(folder)) {
  if (!name.endsWith(".png")) continue;
  const path = join(folder, name);
  const data = await readFile(path);
  const small = await sharp(data).png({ palette: true, quality: 90, effort: 8 }).toBuffer();
  before += data.length;
  after += Math.min(small.length, data.length);
  if (small.length < data.length) await writeFile(path, small);
}
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`${folder}: ${mb(before)} -> ${mb(after)}`);
