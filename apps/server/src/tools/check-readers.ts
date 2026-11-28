// A REAL check: sends files to Plate Recognizer and Gemini and uses the free quota.
//
//   pnpm check:readers                       synthetic test plates and the 4 sample invoices
//   pnpm check:readers --plates-only --folder scripts/test-photos
//   pnpm check:readers --only 05-dim,sand    just the files whose names contain these
//
// In a folder without manifest.json, each photo's name must start with its plate,
// e.g. MH12AB1234-1.jpg.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatPlate, isValidIndianPlate, normalizePlate } from "@trinetra/shared";
import { SAMPLE_INVOICES, type SampleInvoiceId } from "@trinetra/shared/seed";
import { loadConfig } from "../config/env";
import { createDb } from "../db/client";
import { ReaderError } from "../services/readers/errors";
import { createReaders, loadInvoiceLists } from "../services/readers";
import { createGemini } from "../services/readers/gemini";
import { readInvoiceWithGemini } from "../services/readers/invoice";
import { processFile } from "../services/images/pipeline";
import type { PhotoService } from "../hardware/photos";
import type { StorageService } from "../services/storage";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    folder: { type: "string", default: "scripts/test-plates" },
    only: { type: "string" },
    "plates-only": { type: "boolean", default: false },
    "invoices-only": { type: "boolean", default: false },
  },
});
const wanted = (name: string) => !args.only || args.only.split(",").some((p) => name.includes(p));

const env = loadConfig();
const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
const log = {
  warn: (data: unknown, message?: string) => console.warn(`warning: ${message}`, data),
  error: (data: unknown, message?: string) => console.error(`error: ${message}`, data),
} as never;
const readers = createReaders({
  env,
  db,
  storage: {} as StorageService,
  photos: {} as PhotoService,
  log,
});
// Used directly, so the check reads for real even if a demo "pick" mode is switched on.
const gemini = createGemini({
  apiKey: env.GEMINI_API_KEY,
  model: env.GEMINI_MODEL,
  fallbackModel: env.GEMINI_FALLBACK_MODEL,
  usage: readers.usage,
});

const today = new Date().toISOString().slice(0, 10);
const calls = async () => ({
  plateRecognizer: await readers.usage.count("plate_recognizer", today),
  gemini: await readers.usage.count("gemini", today),
});
const before = await calls();

const mimeOf = (name: string) =>
  name.endsWith(".pdf")
    ? "application/pdf"
    : name.endsWith(".png")
      ? "image/png"
      : name.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";

interface PlateCase {
  file: string;
  plate: string | null;
  condition: string;
  readable: boolean;
}

async function plateCases(folder: string): Promise<PlateCase[]> {
  const manifest = resolve(folder, "manifest.json");
  if (existsSync(manifest)) return JSON.parse(await readFile(manifest, "utf8"));
  const files = (await readdir(folder)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
  return files.map((file) => {
    const named = normalizePlate(file.split(/[-_.]/)[0]!);
    return {
      file,
      plate: isValidIndianPlate(named) ? named : null,
      condition: "photo",
      readable: true,
    };
  });
}

if (!args["invoices-only"]) {
  const folder = resolve(root, args.folder);
  if (!existsSync(folder)) {
    console.error(`No such folder: ${folder}`);
    process.exit(1);
  }
  const rows: Record<string, unknown>[] = [];
  let correct = 0;
  for (const test of (await plateCases(folder)).filter((t) => wanted(t.file))) {
    const data = await readFile(resolve(folder, test.file));
    const processed = await processFile(data, mimeOf(test.file.toLowerCase()));
    const read = await readers.readPlate(processed.data);
    // A hidden plate passes only if no whole plate was reported: that would be a guess.
    const pass = test.readable ? read.plate === test.plate : !read.validFormat;
    if (pass) correct += 1;
    rows.push({
      file: test.file,
      condition: test.condition,
      expected: test.readable
        ? test.plate
          ? formatPlate(test.plate)
          : "(name has no plate)"
        : "no full plate",
      got: read.plate ? formatPlate(read.plate) : "(none)",
      source: read.source ?? "-",
      model: read.model ?? "-",
      confidence: read.confidence === null ? "-" : `${Math.round(read.confidence * 100)}%`,
      ms: read.ms,
      problems: read.problems.map((p) => `${p.service}:${p.code}`).join(" ") || "",
      result: pass ? "PASS" : "FAIL",
    });
    console.log(`  ${test.file}: ${pass ? "PASS" : "FAIL"}`);
  }
  console.log(`\nPlates from ${args.folder}: ${correct} of ${rows.length} correct`);
  console.table(rows);
}

if (!args["plates-only"]) {
  // Two PDFs and two photos, so both kinds of file are really tried.
  const FORMAT: Record<SampleInvoiceId, "pdf" | "jpg"> = {
    cement: "pdf",
    "steel-scrap": "jpg",
    sand: "pdf",
    aggregate: "jpg",
    "steel-bars": "pdf",
    bitumen: "jpg",
    "aggregate-10": "pdf",
    bricks: "jpg",
    "scrap-small": "pdf",
    "aggregate-short": "jpg",
  };
  const lists = await loadInvoiceLists(db);
  const rows: Record<string, unknown>[] = [];
  let correct = 0;
  for (const sample of SAMPLE_INVOICES) {
    const file = `${sample.id}.${FORMAT[sample.id]}`;
    if (!wanted(file)) continue;
    const data = await readFile(resolve(root, "scripts/sample-invoices", file));
    const ticketPlate = normalizePlate(sample.printed.vehicle_number);
    try {
      const processed = await processFile(data, mimeOf(file));
      const read = await readInvoiceWithGemini(gemini, processed, { lists, ticketPlate });
      const { printed, expected } = sample;
      const checks: [string, unknown, unknown][] = [
        ["invoice no", read.invoiceNo, printed.invoice_number],
        ["date", read.invoiceDate, printed.invoice_date],
        ["supplier", read.supplier.matched, printed.supplier],
        ["transporter", read.transporter.matched, printed.transporter],
        ["vehicle", read.vehicle.plate, ticketPlate],
        ["material", read.material.matched, expected.material],
        ["weight kg", read.weightKg, expected.weightKg],
        ["warnings", read.warnings.length, 0],
      ];
      const wrong = checks.filter(([, got, want]) => got !== want);
      if (wrong.length === 0) correct += 1;
      rows.push({
        file,
        material: `${read.material.raw} -> ${read.material.matched}`,
        quantity: `${read.quantity.value} ${read.quantity.unit}`,
        kg: read.weightKg,
        supplier: read.supplier.matched,
        vehicle: read.vehicle.plate,
        model: read.model,
        ms: read.ms,
        result:
          wrong.length === 0
            ? "PASS (8/8 fields)"
            : `FAIL: ${wrong.map(([n, got, want]) => `${n} got ${got}, expected ${want}`).join("; ")}`,
      });
    } catch (error) {
      if (!(error instanceof ReaderError)) throw error;
      rows.push({ file, result: `NOT READ: ${error.message}` });
    }
    console.log(`  ${file}: done`);
  }
  console.log(
    `\nSample invoices (main model ${env.GEMINI_MODEL}, backup ${env.GEMINI_FALLBACK_MODEL}): ${correct} of ${rows.length} fully correct`,
  );
  console.table(rows);
}

const after = await calls();
console.log(
  `API requests used by this run: Plate Recognizer ${after.plateRecognizer - before.plateRecognizer}, Gemini ${after.gemini - before.gemini}`,
);
await close();
