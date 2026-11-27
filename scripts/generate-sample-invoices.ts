// Draws the SAMPLE invoices as JPEG and PDF: pnpm sim:invoices
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SAMPLE_INVOICES, type SampleInvoice } from "@trinetra/shared/seed";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

const folder = fileURLToPath(new URL("./sample-invoices/", import.meta.url));
const WARNING = "SAMPLE - NOT A REAL DOCUMENT - made up for the Trinetra prototype demo";

/** "2026-11-26" is printed the Indian way: 26/11/2026. */
const printedDate = (iso: string) => iso.split("-").reverse().join("/");

interface Line {
  text: string;
  x: number;
  /** From the top, on an A4-shaped page of 595 x 842. */
  y: number;
  size: number;
  bold?: boolean;
  red?: boolean;
}

/** One layout, used for both file types. */
function layout({ printed, quantityText }: SampleInvoice): Line[] {
  const row = (label: string, value: string, y: number): Line[] => [
    { text: label, x: 48, y, size: 11 },
    { text: value, x: 190, y, size: 12, bold: true },
  ];
  return [
    { text: "SAMPLE INVOICE", x: 48, y: 64, size: 26, bold: true },
    { text: WARNING, x: 48, y: 86, size: 10, bold: true, red: true },
    ...row("Supplier (sold by)", printed.supplier, 130),
    ...row("Invoice No.", printed.invoice_number, 154),
    ...row("Invoice Date", printedDate(printed.invoice_date), 178),
    ...row("Buyer", "Demo Road Project (sample)", 202),
    ...row("Transporter", printed.transporter, 240),
    ...row("Vehicle No.", printed.vehicle_number, 264),
    { text: "Description of goods", x: 48, y: 320, size: 11, bold: true },
    { text: "Net quantity", x: 360, y: 320, size: 11, bold: true },
    { text: "Unit", x: 480, y: 320, size: 11, bold: true },
    { text: printed.material, x: 48, y: 350, size: 12 },
    { text: quantityText, x: 360, y: 350, size: 13, bold: true },
    { text: printed.quantity_unit, x: 480, y: 350, size: 13, bold: true },
    { text: "Goods once dispatched are for demonstration only.", x: 48, y: 440, size: 10 },
    { text: WARNING, x: 48, y: 790, size: 10, bold: true, red: true },
  ];
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg(invoice: SampleInvoice): Buffer {
  const texts = layout(invoice)
    .map(
      (line) =>
        `<text x="${line.x}" y="${line.y}" font-size="${line.size}" fill="${line.red ? "#b91c1c" : "#111"}"` +
        `${line.bold ? ' font-weight="bold"' : ""}>${escapeXml(line.text)}</text>`,
    )
    .join("\n");
  // Drawn at twice the size, so the small print stays sharp.
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1190" height="1684" viewBox="0 0 595 842"
    font-family="Arial, 'DejaVu Sans', sans-serif">
  <rect width="595" height="842" fill="#fff"/>
  <text x="297" y="560" text-anchor="middle" font-size="130" font-weight="bold" fill="#dc2626" opacity="0.13"
    transform="rotate(-30 297 560)">SAMPLE</text>
  <line x1="40" y1="300" x2="555" y2="300" stroke="#111"/>
  <line x1="40" y1="330" x2="555" y2="330" stroke="#111"/>
  <line x1="40" y1="370" x2="555" y2="370" stroke="#111"/>
  ${texts}
</svg>`);
}

async function pdf(invoice: SampleInvoice): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`SAMPLE invoice ${invoice.printed.invoice_number}`);
  // A fixed date, so drawing again gives the same file.
  const date = new Date("2026-11-26T00:00:00Z");
  document.setCreationDate(date);
  document.setModificationDate(date);
  const page = document.addPage([595, 842]);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  page.drawText("SAMPLE", {
    x: 105,
    y: 190,
    size: 120,
    font: bold,
    color: rgb(0.86, 0.15, 0.15),
    opacity: 0.13,
    rotate: degrees(30),
  });
  for (const y of [842 - 300, 842 - 330, 842 - 370]) {
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 1 });
  }
  for (const line of layout(invoice)) {
    page.drawText(line.text, {
      x: line.x,
      y: 842 - line.y,
      size: line.size,
      font: line.bold ? bold : regular,
      color: line.red ? rgb(0.73, 0.11, 0.11) : rgb(0.07, 0.07, 0.07),
    });
  }
  return document.save();
}

await mkdir(folder, { recursive: true });
for (const invoice of SAMPLE_INVOICES) {
  await sharp(svg(invoice)).jpeg({ quality: 88 }).toFile(`${folder}${invoice.id}.jpg`);
  await writeFile(`${folder}${invoice.id}.pdf`, await pdf(invoice));
  console.log(`${invoice.id}: ${invoice.scenario}`);
}
