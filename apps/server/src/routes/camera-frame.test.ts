// The camera flow: pretend cameras POST their frames; the backend keeps only the newest of
// each, and saves one only when a photo of the truck is wanted.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_FRAME_AGE_MS, type CameraId } from "@trinetra/shared";
import { count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app";
import { MAX_FRAME_BYTES } from "../config/limits";
import { createDb } from "../db/client";
import { photos, tickets } from "../db/schema";
import { seedDatabase } from "../db/seed";
import { LocalStorage } from "../services/storage";
import { resetTestDatabase } from "../test/database";
import { connectDevice, deviceTokenEnv, TEST_DEVICE_TOKENS } from "../test/device-client";
import { testDatabaseUrl, testEnv } from "../test/env";

const WAIT_MS = 300;
/** A real little picture; different colours give different files. */
const picture = (background: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background } })
    .jpeg()
    .toBuffer();
const RED = await picture("#ff0000");
const BLUE = await picture("#0000ff");
const GREEN = await picture("#00ff00");

describe.skipIf(!testDatabaseUrl)("camera frames", { timeout: 20_000 }, () => {
  let folder: string;
  let storage: LocalStorage;
  let connection: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  /** The backend's clock for the age of a frame, moved by the tests. */
  let clock: number;

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    connection = createDb(testDatabaseUrl!, { max: 1 });
    await seedDatabase(connection.db);
    folder = await mkdtemp(join(tmpdir(), "trinetra-frames-"));
  }, 60_000);
  afterAll(async () => {
    await connection?.close();
    await rm(folder, { recursive: true, force: true });
  });

  beforeEach(async () => {
    clock = 1_000_000;
    storage = new LocalStorage(folder, testEnv().JWT_SECRET);
    app = await buildApp({
      env: testEnv(deviceTokenEnv),
      storage,
      hardware: {
        settings: {
          wakeThresholdKg: 500,
          stableWindowMs: 3000,
          stableSpreadKg: 10,
          modelScaleKgPerG: 100,
        },
        photoTimeoutMs: WAIT_MS,
        now: () => clock,
      },
    });
    await app.ready();
  });
  afterEach(() => app.close());

  const send = (
    camera: string,
    body: Buffer = RED,
    // null sends no token header. (undefined would pick this default.)
    token: string | null = TEST_DEVICE_TOKENS[camera as CameraId] ?? TEST_DEVICE_TOKENS.front,
    contentType = "image/jpeg",
  ) =>
    app.inject({
      method: "POST",
      url: `/api/cam/${camera}`,
      headers: { "content-type": contentType, ...(token ? { "x-device-token": token } : {}) },
      payload: body,
    });

  const savedPhotos = async () =>
    (await connection.db.select({ saved: count() }).from(photos))[0]!.saved;

  const colourOf = async (storagePath: string) =>
    (await sharp(await readFile(join(folder, storagePath))).stats()).dominant;

  describe("POST /api/cam/:camera", () => {
    it("takes a frame without saving anything", async () => {
      const before = await savedPhotos();
      const read = vi.spyOn(app.readers, "readPlate");

      for (let n = 0; n < 5; n++) expect((await send("front")).statusCode).toBe(204);

      expect(await savedPhotos()).toBe(before);
      // The plate services are asked only when a photo is wanted, never for a frame.
      expect(read).not.toHaveBeenCalled();
    });

    it.each([
      ["no token", null, 401, "INVALID_DEVICE_TOKEN"],
      ["a wrong token", "wrong-token-of-some-length", 401, "INVALID_DEVICE_TOKEN"],
      ["the other camera's token", TEST_DEVICE_TOKENS.back, 403, "WRONG_CAMERA"],
      ["the main ESP32's token", TEST_DEVICE_TOKENS.main, 403, "WRONG_CAMERA"],
    ])("refuses a frame with %s", async (_label, token, status, code) => {
      const response = await send("front", RED, token);
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(code);
      expect(app.hardware.state.isOnline("front")).toBe(false);
    });

    it("knows only the front and back cameras", async () => {
      expect((await send("exit", RED, TEST_DEVICE_TOKENS.front)).statusCode).toBe(404);
    });

    it.each(["image/png", "application/json", "text/plain", "multipart/form-data; boundary=x"])(
      "refuses %s",
      async (type) => {
        expect((await send("front", RED, TEST_DEVICE_TOKENS.front, type)).statusCode).toBe(415);
      },
    );

    it("refuses bytes that are not a JPEG, which prove no camera", async () => {
      expect((await send("front", Buffer.from("hello"))).statusCode).toBe(415);
      expect(app.hardware.state.isOnline("front")).toBe(false);
    });

    it("refuses a frame that is too big", async () => {
      const big = Buffer.concat([RED, Buffer.alloc(MAX_FRAME_BYTES)]);
      expect((await send("front", big)).statusCode).toBe(413);
    });

    it("is not open to a camera over the weighbridge's connection", async () => {
      const url = await app.listen({ port: 0, host: "127.0.0.1" });
      const camera = await connectDevice(url, TEST_DEVICE_TOKENS.front);
      expect(await camera.closed).toEqual({
        code: 1008,
        reason: "cameras send their frames to /api/cam",
      });
    });
  });

  describe("online and offline", () => {
    it("is online from its first frame and offline after 15 seconds without one", async () => {
      const seen: unknown[] = [];
      app.hardware.bus.on("hw:status", (event) => seen.push(event));

      await send("back");
      expect(app.hardware.state.isOnline("back")).toBe(true);
      expect(app.hardware.state.isOnline("front")).toBe(false);
      expect(app.hardware.lastHeard("back")).toBeInstanceOf(Date);
      expect(app.hardware.lastHeard("front")).toBeNull();

      clock += 15_001;
      app.hardware.state.checkTimeouts();
      expect(app.hardware.state.isOnline("back")).toBe(false);
      expect(seen).toEqual([
        { device: "back", online: true },
        { device: "back", online: false },
      ]);
      // "Last seen" is kept for the settings page and the weighbridge screen.
      expect(app.hardware.lastHeard("back")).toBeInstanceOf(Date);
    });
  });

  describe("the photo of the truck", () => {
    it("saves the newest frame of each camera, for a ticket", async () => {
      await send("front", GREEN);
      await send("front", RED);
      await send("back", BLUE);
      const [ticket] = await connection.db
        .insert(tickets)
        .values({ ticketNo: "FRAME-1", plate: "MH12AB1234", language: "en" })
        .returning();

      const result = await app.hardware.photos.requestPhotos(ticket!.id);

      expect(result.failed).toEqual([]);
      for (const [name, kind] of [
        ["front", "FRONT_PLATE"],
        ["back", "BACK_PLATE"],
      ] as const) {
        const photo = result.photos[name]!;
        const bytes = await readFile(join(folder, photo.storagePath));
        expect(photo.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        const [row] = await connection.db.select().from(photos).where(eq(photos.id, photo.id));
        expect(row).toMatchObject({ ticketId: ticket!.id, kind, sha256: photo.sha256 });
      }
      // The front camera's second frame (red), not its first (green).
      const front = await colourOf(result.photos.front!.storagePath);
      expect(front.r).toBeGreaterThan(front.g);
      const back = await colourOf(result.photos.back!.storagePath);
      expect(back.b).toBeGreaterThan(back.r);
    });

    it("uses a frame exactly 3 seconds old", async () => {
      await send("front");
      await send("back");
      clock += MAX_FRAME_AGE_MS;
      expect((await app.hardware.photos.requestPhotos(null)).failed).toEqual([]);
    });

    it("never uses a frame older than 3 seconds: it waits, then gives up", async () => {
      await send("front");
      await send("back");
      clock += MAX_FRAME_AGE_MS + 1;
      const before = await savedPhotos();

      const result = await app.hardware.photos.requestPhotos(null);

      expect(result).toEqual({
        photos: {},
        failed: [
          { camera: "front", reason: "TIMEOUT" },
          { camera: "back", reason: "TIMEOUT" },
        ],
      });
      expect(await savedPhotos()).toBe(before);
    });

    it("waits for the next frame when the newest is too old", async () => {
      await send("front", GREEN);
      await send("back", BLUE);
      clock += MAX_FRAME_AGE_MS + 1;
      await send("back", BLUE);

      const waiting = app.hardware.photos.requestPhotos(null);
      await send("front", RED);
      const result = await waiting;

      expect(result.failed).toEqual([]);
      const front = await colourOf(result.photos.front!.storagePath);
      expect(front.r).toBeGreaterThan(front.g);
    });

    it("says OFFLINE at once for a camera that sends nothing", async () => {
      await send("front");
      const started = Date.now();

      const result = await app.hardware.photos.requestPhotos(null);

      expect(result.photos.front).toBeDefined();
      expect(result.failed).toEqual([{ camera: "back", reason: "OFFLINE" }]);
      expect(Date.now() - started).toBeLessThan(WAIT_MS * 3);
    });

    it("says SAVE_FAILED when the photo cannot be saved", async () => {
      await send("front");
      // A JPEG that starts well and is then rubbish.
      await send("back", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("junk")]));
      const result = await app.hardware.photos.requestPhotos(null);
      expect(result.failed).toEqual([{ camera: "back", reason: "SAVE_FAILED" }]);
    });
  });
});
