import type { UserRole } from "@trinetra/shared";
import { SAMPLE_INVOICES } from "@trinetra/shared/seed";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createDb } from "../db/client";
import { photos } from "../db/schema";
import { seedDatabase } from "../db/seed";
import { SESSION_COOKIE } from "../plugins/security";
import { resetTestDatabase } from "../test/database";
import { testDatabaseUrl, testEnv } from "../test/env";
import { fakeApis, geminiText, json, plates } from "../test/fake-apis";

const SAMPLES = new URL("../../../../scripts/sample-invoices/", import.meta.url);

describe.skipIf(!testDatabaseUrl)("dev reader routes", { timeout: 30_000 }, () => {
  let connection: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  let apis: ReturnType<typeof fakeApis>;
  let photo: Buffer;

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    connection = createDb(testDatabaseUrl!, { max: 2 });
    await seedDatabase(connection.db);
    photo = await sharp({ create: { width: 60, height: 40, channels: 3, background: "#999" } })
      .jpeg()
      .toBuffer();
  }, 60_000);
  afterAll(() => connection?.close());

  async function start(handlers: Parameters<typeof fakeApis>[0], nodeEnv = "test") {
    apis = fakeApis(handlers);
    app = await buildApp({
      env: testEnv({
        NODE_ENV: nodeEnv,
        PLATE_RECOGNIZER_TOKEN: "fake-token",
        GEMINI_API_KEY: "fake-key",
      }),
      hardware: {
        settings: {
          wakeThresholdKg: 500,
          stableWindowMs: 3000,
          stableSpreadKg: 10,
          modelScaleKgPerG: 100,
        },
      },
      readers: { fetch: apis.fetch },
    });
  }
  beforeEach(() => start({ plateRecognizer: () => plates(["MH12AB1234", 0.88]) }));
  afterEach(() => app.close());

  function send(url: string, data: Buffer, type: string, role: UserRole | null = "KIOSK") {
    const boundary = "trinetra-test-boundary";
    return app.inject({
      method: "POST",
      url,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      cookies: role
        ? { [SESSION_COOKIE]: app.jwt.sign({ userId: 1, role, name: "T", use: "session" }) }
        : {},
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f"\r\n` +
            `Content-Type: ${type}\r\n\r\n`,
        ),
        data,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
  }

  it.each(["/api/dev/read-plate", "/api/dev/read-invoice"])(
    "%s is for the kiosk only",
    async (url) => {
      expect((await send(url, photo, "image/jpeg", null)).statusCode).toBe(401);
      expect((await send(url, photo, "image/jpeg", "STORE")).statusCode).toBe(403);
      expect(apis.calls.plateRecognizer).toHaveLength(0);
    },
  );

  it.each(["/api/dev/read-plate", "/api/dev/read-invoice"])(
    "%s does not exist in production",
    async (url) => {
      await app.close();
      await start({}, "production");
      expect((await send(url, photo, "image/jpeg")).statusCode).toBe(404);
    },
  );

  it("reads a plate and says the source, confidence and time, saving nothing", async () => {
    const response = await send("/api/dev/read-plate", photo, "image/jpeg");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      result: { plate: "MH12AB1234", source: "plate_recognizer", confidence: 0.88 },
      totalMs: expect.any(Number),
    });
    expect(await connection.db.$count(photos)).toBe(0);
  });

  it("refuses a PDF as a plate photo, and a wrong file type", async () => {
    const pdf = Buffer.from("%PDF-1.7 x");
    expect((await send("/api/dev/read-plate", pdf, "application/pdf")).statusCode).toBe(415);
    expect((await send("/api/dev/read-plate", Buffer.from("x"), "text/plain")).statusCode).toBe(
      415,
    );
    expect(apis.calls.plateRecognizer).toHaveLength(0);
  });

  it.each(["cement.pdf", "cement.jpg"])("reads the invoice file %s", async (name) => {
    await app.close();
    const sample = SAMPLE_INVOICES.find((s) => s.id === "cement")!;
    await start({ gemini: () => geminiText(JSON.stringify(sample.printed)) });

    const type = name.endsWith("pdf") ? "application/pdf" : "image/jpeg";
    const response = await send(
      "/api/dev/read-invoice?plate=MH14CD5678",
      await readFile(new URL(name, SAMPLES)),
      type,
    );

    expect(response.json().result).toMatchObject({
      weightKg: 14_310,
      material: { matched: "Cement Bags" },
      warnings: [{ code: "VEHICLE_MISMATCH" }],
      source: "gemini",
    });
    const sent = JSON.parse(apis.calls.gemini[0]!.body as string);
    expect(sent.input[0].mime_type).toBe(type);
  });

  it.each([
    [429, 503, "READER_RATE_LIMITED"],
    [403, 502, "READER_AUTH_OR_CREDITS"],
  ])("reports Gemini HTTP %i as %i %s", async (upstream, status, code) => {
    await app.close();
    await start({ gemini: () => json({}, upstream) });

    const response = await send("/api/dev/read-invoice", photo, "image/jpeg");

    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    expect(response.body).not.toContain("fake-key");
  });
});
