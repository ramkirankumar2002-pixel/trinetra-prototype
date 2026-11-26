// The invoice reader with a pretend Gemini.
import { SEED_MATERIALS, SEED_SUPPLIERS, SEED_TRANSPORTERS } from "@trinetra/shared/seed";
import { describe, expect, it } from "vitest";
import { fakeApis, geminiText, json } from "../../test/fake-apis";
import { createGemini } from "./gemini";
import {
  interpretInvoice,
  readInvoiceWithGemini,
  toKg,
  type InvoiceLists,
  type RawInvoice,
} from "./invoice";

const lists: InvoiceLists = {
  materials: SEED_MATERIALS,
  suppliers: [...SEED_SUPPLIERS],
  transporters: [...SEED_TRANSPORTERS],
};

const full: RawInvoice = {
  invoice_number: "SMPL-001",
  invoice_date: "2026-11-26",
  supplier: "M/s Sample Cement Depot Pvt. Ltd.",
  transporter: "SRI BALAJI TRANSPORT",
  vehicle_number: "MH 12 AB 1234",
  material: "OPC 53 Grade Cement",
  quantity: 14.31,
  quantity_unit: "MT",
};
const nothing: RawInvoice = {
  invoice_number: null,
  invoice_date: null,
  supplier: null,
  transporter: null,
  vehicle_number: null,
  material: null,
  quantity: null,
  quantity_unit: null,
};

const interpret = (changes: Partial<RawInvoice> = {}, ticketPlate: string | null = "MH12AB1234") =>
  interpretInvoice({ ...full, ...changes }, { lists, ticketPlate, source: "gemini", ms: 5 });
const codes = (read: ReturnType<typeof interpret>) => read.warnings.map((w) => w.code);

describe("interpretInvoice", () => {
  it("keeps the written text and the matched name side by side", () => {
    expect(interpret()).toEqual({
      invoiceNo: "SMPL-001",
      invoiceDate: "2026-11-26",
      supplier: { raw: "M/s Sample Cement Depot Pvt. Ltd.", matched: "Sample Cement Depot" },
      transporter: { raw: "SRI BALAJI TRANSPORT", matched: "Sri Balaji Transport" },
      material: { raw: "OPC 53 Grade Cement", matched: "Cement Bags" },
      vehicle: { raw: "MH 12 AB 1234", plate: "MH12AB1234" },
      quantity: { value: 14.31, unit: "MT" },
      weightKg: 14_310,
      warnings: [],
      source: "gemini",
      ms: 5,
    });
  });

  it("leaves every unread field empty, with no warnings invented", () => {
    const read = interpretInvoice(nothing, {
      lists,
      ticketPlate: "MH12AB1234",
      source: "gemini",
      ms: 1,
    });
    expect(read).toMatchObject({
      invoiceNo: null,
      invoiceDate: null,
      supplier: { raw: null, matched: null },
      transporter: { raw: null, matched: null },
      material: { raw: null, matched: null },
      vehicle: { raw: null, plate: null },
      quantity: { value: null, unit: null },
      weightKg: null,
      warnings: [],
    });
  });

  it.each(["", "  ", "null", "N/A", "-", "Unknown", "not visible"])(
    "treats %j as empty",
    (word) => {
      expect(interpret({ invoice_number: word }).invoiceNo).toBeNull();
    },
  );

  it.each(["26/11/2026", "2026-02-31", "2026-13-01", "yesterday", "2026-11-26T00:00"])(
    "drops the date %s",
    (date) => {
      expect(interpret({ invoice_date: date }).invoiceDate).toBeNull();
    },
  );

  it("keeps a name that is not in our lists, unmatched", () => {
    expect(interpret({ supplier: "Shree Ram Traders" }).supplier).toEqual({
      raw: "Shree Ram Traders",
      matched: null,
    });
  });

  it("warns when the material is not clearly one of ours", () => {
    for (const material of ["40 mm Aggregate", "Cement and Sand", "Gypsum"]) {
      const read = interpret({ material });
      expect(read.material).toEqual({ raw: material, matched: null });
      expect(codes(read)).toEqual(["MATERIAL_NOT_RECOGNISED"]);
    }
  });

  describe("vehicle number", () => {
    it("warns when the invoice is for another truck", () => {
      const read = interpret({ vehicle_number: "MH-14-CD-5678" });
      expect(read.warnings).toEqual([
        {
          code: "VEHICLE_MISMATCH",
          message: "The invoice is for MH 14 CD 5678, but this truck is MH 12 AB 1234.",
        },
      ]);
    });

    it.each(["mh12ab1234", "MH-12 AB-1234", "MH.12.AB.1234"])(
      "accepts the same plate written %s",
      (vehicle_number) => {
        expect(codes(interpret({ vehicle_number }))).toEqual([]);
      },
    );

    it("does not warn without a ticket or without a number", () => {
      expect(codes(interpret({ vehicle_number: "MH14CD5678" }, null))).toEqual([]);
      expect(codes(interpret({ vehicle_number: null }))).toEqual([]);
    });
  });

  describe("weight", () => {
    it.each([
      [1500, "kg", 1500],
      [1500, "KGS.", 1500],
      [900, "Kilograms", 900],
      [14.5, "MT", 14_500],
      [14.5, "M.T.", 14_500],
      [1.5, "Tonnes", 1500],
      [1.5, "ton", 1500],
      [2, "T", 2000],
      [3, "Metric Tonnes", 3000],
      [1.5, "टन", 1500],
      [9, "Quintal", 900],
      [9.005, "Qtl.", 901],
      [14.3105, "MT", 14_311],
      [12, "क्विंटल", 1200],
    ])("converts %s %s to %i kg", (value, unit, kg) => {
      expect(toKg(value, unit)).toBe(kg);
    });

    it.each([
      [280, "Bags"],
      [10, "m3"],
      [10, "CFT"],
      [4, "Nos"],
      [5, ""],
      [5, "q"],
      [14_500, "MT"], // a misplaced decimal point: no truck carries this
      [0.0001, "kg"],
      [0, "kg"],
      [-5, "MT"],
      [Number.NaN, "kg"],
    ])("gives no weight for %s %j", (value, unit) => {
      expect(toKg(value, unit)).toBeNull();
    });

    it("warns when a quantity cannot be turned into a weight", () => {
      const read = interpret({ quantity: 280, quantity_unit: "Bags" });
      expect(read).toMatchObject({ weightKg: null, quantity: { value: 280, unit: "Bags" } });
      expect(codes(read)).toEqual(["WEIGHT_UNIT_UNKNOWN"]);
    });

    it("never assumes kilograms when there is no unit", () => {
      expect(interpret({ quantity: 1500, quantity_unit: null }).weightKg).toBeNull();
    });
  });
});

describe("readInvoiceWithGemini", () => {
  function gemini(answer: () => Response) {
    const apis = fakeApis({ gemini: answer });
    const client = createGemini({
      apiKey: "test-key",
      model: "gemini-test",
      usage: { record: async () => {} },
      fetch: apis.fetch,
      busyRetryDelaysMs: [],
    });
    return { apis, client };
  }
  const context = { lists, ticketPlate: "MH12AB1234" };

  it.each([
    ["application/pdf", "document"],
    ["image/jpeg", "image"],
  ])("sends a %s as a %s part with a strict schema", async (contentType, partType) => {
    const { apis, client } = gemini(() => geminiText(JSON.stringify(full)));
    const data = Buffer.from("file bytes");

    const read = await readInvoiceWithGemini(client, { data, contentType }, context);

    expect(read.weightKg).toBe(14_310);
    const body = JSON.parse(apis.calls.gemini[0]!.body as string);
    expect(body.input[0]).toEqual({
      type: partType,
      mime_type: contentType,
      data: data.toString("base64"),
    });
    expect(body.input[1].text).toMatch(/Never guess/);
    expect(body.response_format.schema.required).toHaveLength(8);
    expect(body.response_format.schema.properties.supplier).toEqual({ type: ["string", "null"] });
    expect(body.response_format.schema.properties.quantity).toEqual({ type: ["number", "null"] });
  });

  it.each([
    ["a missing field", { ...full, supplier: undefined }],
    ["a number as text", { ...full, quantity: "14.31" }],
    ["another object", { total: 5 }],
  ])("refuses an answer with %s", async (_label, answer) => {
    const { client } = gemini(() => geminiText(JSON.stringify(answer)));
    await expect(
      readInvoiceWithGemini(client, { data: Buffer.from("x"), contentType: "image/jpeg" }, context),
    ).rejects.toMatchObject({ code: "BAD_ANSWER" });
  });

  it("fails clearly when Gemini cannot be used", async () => {
    const { client } = gemini(() => json({}, 429));
    await expect(
      readInvoiceWithGemini(client, { data: Buffer.from("x"), contentType: "image/jpeg" }, context),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
