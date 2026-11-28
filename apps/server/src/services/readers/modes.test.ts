// "pick" demo mode: no reading service, no files, no network.
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
  const save = vi.fn<(data: Buffer, path: string, type: string) => Promise<object>>(
    async (_data, path) => ({ path, sha256: "test" }),
  );
  // Any call at all is an error: pick mode must not use the network.
  const apis = fakeApis({});
  const log = { warn: () => {} } as unknown as FastifyBaseLogger;
  const readers = () =>
    createReaders({
      env: testEnv(),
      db: connection.db,
      storage: { save } as unknown as StorageService,
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
    save.mockClear();
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
    it("gives the picked plate from the vehicle list without any reading service", async () => {
      await set({ anpr_mode: "pick", demo_plate: "UP 32 EF 9012" });
      const result = await readers().readPlates(null);

      expect(result).toMatchObject({ plate: "UP32EF9012", match: true, demo: true });
      expect(result.cameras.back).toMatchObject({
        plate: "UP32EF9012",
        source: "demo",
        confidence: null,
        cameraFailure: null,
      });
      expect(apis.calls.plateRecognizer).toHaveLength(0);
    });

    it("asks no camera, and saves a drawn photo of the picked plate for each", async () => {
      await set({ anpr_mode: "pick", demo_plate: "UP32EF9012" });
      const { cameras } = await readers().readPlates(null);
      // A camera's photo could show another plate than the one picked.
      expect(requestPhotos).not.toHaveBeenCalled();
      expect(cameras.front.photoId).toEqual(expect.any(String));
      expect(cameras.back.photoId).not.toBe(cameras.front.photoId);
      expect(save).toHaveBeenCalledTimes(2);
      const [data, , type] = save.mock.calls[0]!;
      expect(type).toBe("image/jpeg");
      expect(data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
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

  describe("the supervisor's own switch", () => {
    // fakeApis({}) answers nothing, and the test key is empty: a real reading fails.
    const photo = Buffer.from([0xff, 0xd8, 0xff]);

    it("is real while only the kiosk's plate reading is on pick", async () => {
      await set({ anpr_mode: "pick", demo_plate: "UP32EF9012" });
      const read = await readers().readSupervisorPlate(photo);
      expect(read.source).not.toBe("demo");
      expect(read.plate).toBeNull();
    });

    it("gives the picked plate on pick, whatever the kiosk's switch says", async () => {
      await set({ supervisor_anpr_mode: "pick", demo_plate: "UP32EF9012" });
      expect(await readers().readSupervisorPlate(photo)).toMatchObject({
        plate: "UP32EF9012",
        source: "demo",
      });
      expect(apis.calls.plateRecognizer).toHaveLength(0);
      expect(apis.calls.gemini).toHaveLength(0);
    });

    it("leaves the kiosk's plate reading real", async () => {
      await set({ supervisor_anpr_mode: "pick" });
      await readers().readPlates(null);
      expect(requestPhotos).toHaveBeenCalled();
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
    ["supervisor_anpr_mode", "yes"],
    ["demo_invoice", "gravel"],
  ])("refuses a wrong value for %s", async (key, value) => {
    await set({ [key]: value });
    await expect(readers().readPlates(null)).rejects.toThrow();
  });
});
