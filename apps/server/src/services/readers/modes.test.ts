// "pick" demo mode: no cameras, no files, no network.
import { checkTolerance, classifyType } from "@trinetra/shared";
import { SAMPLE_INVOICE_IDS, SAMPLE_INVOICES, SEED_MATERIALS } from "@trinetra/shared/seed";
import type { FastifyBaseLogger } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../../db/client";
import { settings } from "../../db/schema";
import { seedDatabase } from "../../db/seed";
import { resetTestDatabase } from "../../test/database";
import { testDatabaseUrl, testEnv } from "../../test/env";
import { fakeApis } from "../../test/fake-apis";
import type { StorageService } from "../storage";
import { createReaders } from "./index";

describe.skipIf(!testDatabaseUrl)("demo pick modes", { timeout: 30_000 }, () => {
  let connection: ReturnType<typeof createDb>;
  const requestPhotos = vi.fn(async () => ({ photos: {}, failed: [] }));
  // Any call at all is an error: pick mode must not use the network.
  const apis = fakeApis({});
  const log = { warn: () => {} } as unknown as FastifyBaseLogger;
  const readers = () =>
    createReaders({
      env: testEnv(),
      db: connection.db,
      storage: {} as StorageService,
      photos: { requestPhotos },
      log,
      fetch: apis.fetch,
    });

  async function set(values: Record<string, string>) {
    for (const [key, value] of Object.entries(values)) {
      await connection.db
        .insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    }
  }

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    connection = createDb(testDatabaseUrl!, { max: 2 });
  }, 60_000);
  afterAll(() => connection?.close());
  beforeEach(async () => {
    await seedDatabase(connection.db, { reset: true });
    requestPhotos.mockClear();
  }, 60_000);

  it("is real by default", async () => {
    await readers().readPlates(null);
    expect(requestPhotos).toHaveBeenCalledWith(null);
  });

  it("treats a missing mode as real", async () => {
    await connection.db.delete(settings);
    await readers().readPlates(null);
    expect(requestPhotos).toHaveBeenCalled();
  });

  describe("anpr_mode = pick", () => {
    it("gives the picked plate from the vehicle list without using the cameras", async () => {
      await set({ anpr_mode: "pick", demo_plate: "UP 32 EF 9012" });
      const result = await readers().readPlates(null);

      expect(result).toMatchObject({ plate: "UP32EF9012", match: true, demo: true });
      expect(result.cameras.back).toMatchObject({
        plate: "UP32EF9012",
        source: "demo",
        confidence: null,
        photoId: null,
        cameraFailure: null,
      });
      expect(requestPhotos).not.toHaveBeenCalled();
      expect(apis.calls.plateRecognizer).toHaveLength(0);
    });

    it("refuses a plate that is not in the vehicle list", async () => {
      await set({ anpr_mode: "pick", demo_plate: "MH99ZZ9999" });
      await expect(readers().readPlates(null)).rejects.toMatchObject({
        code: "DEMO_SETTING_INVALID",
      });
    });

    it("does not change invoice reading", async () => {
      await set({ anpr_mode: "pick" });
      await expect(readers().readInvoice(null, null)).rejects.toMatchObject({ code: "NO_FILE" });
    });
  });

  describe("ocr_mode = pick", () => {
    it.each(SAMPLE_INVOICE_IDS)(
      "gives the %s sample, which reads and classifies as planned",
      async (id) => {
        await set({ ocr_mode: "pick", demo_invoice: id });
        const sample = SAMPLE_INVOICES.find((item) => item.id === id)!;

        const read = await readers().readInvoice(null, sample.printed.vehicle_number);

        expect(read).toMatchObject({
          source: "demo",
          model: null,
          invoiceNo: sample.printed.invoice_number,
          material: { raw: sample.printed.material, matched: sample.expected.material },
          supplier: { matched: sample.printed.supplier },
          transporter: { matched: sample.printed.transporter },
          weightKg: sample.expected.weightKg,
          warnings: [],
        });
        const material = SEED_MATERIALS.find((m) => m.name === sample.expected.material)!;
        expect(classifyType(material, read.weightKg)).toMatchObject({
          type: sample.expected.type,
        });
        expect(apis.calls.gemini).toHaveLength(0);
      },
    );

    it("still warns if the picked invoice is for another truck", async () => {
      await set({ ocr_mode: "pick", demo_invoice: "sand" });
      const read = await readers().readInvoice(null, "MH12AB1234");
      expect(read.warnings.map((w) => w.code)).toEqual(["VEHICLE_MISMATCH"]);
    });

    it("has one sample that fails tolerance against the simulator's truck", () => {
      const net = 32_560 - 18_250;
      const results = Object.fromEntries(
        SAMPLE_INVOICES.map((s) => [s.id, checkTolerance(net, s.expected.weightKg).pass]),
      );
      expect(results.aggregate).toBe(false);
      expect(results.cement).toBe(true);
    });
  });

  it.each([
    ["anpr_mode", "Pick"],
    ["ocr_mode", "fake"],
    ["demo_invoice", "gravel"],
  ])("refuses a wrong value for %s", async (key, value) => {
    await set({ [key]: value });
    await expect(readers().readPlates(null)).rejects.toThrow();
  });
});
