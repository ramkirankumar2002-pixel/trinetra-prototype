// The camera flow: pretend cameras get "snap" over WebSocket and upload over HTTP.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CameraId } from "@trinetra/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { MAX_UPLOAD_BYTES } from "../config/limits";
import { createDb } from "../db/client";
import { photos, tickets } from "../db/schema";
import { seedDatabase } from "../db/seed";
import { LocalStorage } from "../services/storage";
import { resetTestDatabase } from "../test/database";
import {
  connectDevice,
  deviceTokenEnv,
  TEST_DEVICE_TOKENS,
  waitFor,
  type TestDevice,
} from "../test/device-client";
import { testDatabaseUrl, testEnv } from "../test/env";

const TIMEOUT_MS = 300;
/** A real little picture; different colours give different files. */
const picture = (background: string) =>
  sharp({ create: { width: 64, height: 48, channels: 3, background } })
    .jpeg()
    .toBuffer();
const PICTURES = {
  photo: await picture("#808080"),
  front: await picture("#ff0000"),
  back: await picture("#0000ff"),
  another: await picture("#00ff00"),
};
const jpeg = (name: keyof typeof PICTURES = "photo") => PICTURES[name];

describe.skipIf(!testDatabaseUrl)("camera photos", { timeout: 20_000 }, () => {
  let folder: string;
  let storage: LocalStorage;
  let connection: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  let url: string;
  const devices: TestDevice[] = [];

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    connection = createDb(testDatabaseUrl!, { max: 1 });
    await seedDatabase(connection.db);
    folder = await mkdtemp(join(tmpdir(), "trinetra-photos-"));
  }, 60_000);
  afterAll(async () => {
    await connection?.close();
    await rm(folder, { recursive: true, force: true });
  });

  beforeEach(async () => {
    storage = new LocalStorage(folder, testEnv().JWT_SECRET);
    app = await buildApp({
      env: testEnv(deviceTokenEnv),
      storage,
      hardware: {
        settings: { wakeThresholdKg: 500, stableWindowMs: 3000, stableSpreadKg: 10 },
        photoTimeoutMs: TIMEOUT_MS,
      },
    });
    url = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterEach(async () => {
    devices.splice(0).forEach((device) => device.socket.terminate());
    await app.close();
  });

  const upload = (
    photoId: string,
    body: Buffer = jpeg(),
    // null sends no token header. (undefined would pick this default.)
    token: string | null = TEST_DEVICE_TOKENS.front,
    contentType = "image/jpeg",
  ) =>
    app.inject({
      method: "POST",
      url: `/api/device/photo/${photoId}`,
      headers: { "content-type": contentType, ...(token ? { "x-device-token": token } : {}) },
      payload: body,
    });

  /**
   * A pretend camera. `answer` says what it does for each snap it receives:
   * by default it uploads a photo.
   */
  async function camera(
    name: CameraId,
    answer: (id: string, snapNumber: number) => unknown = (id) =>
      upload(id, jpeg(name), TEST_DEVICE_TOKENS[name]),
  ) {
    const device = await connectDevice(url, TEST_DEVICE_TOKENS[name]);
    devices.push(device);
    let snaps = 0;
    device.socket.on("message", (data) => {
      const message = JSON.parse(data.toString());
      if (message.t === "snap") void answer(message.id, ++snaps);
    });
    device.send({ t: "hello", cam: name });
    await waitFor(() => app.hardware.state.isOnline(name));
    return device;
  }

  const snapIds = (device: TestDevice) =>
    device.received.filter((m) => m.t === "snap").map((m) => m.id as string);

  describe("requestPhotos", () => {
    it("returns both photos, saved and recorded", async () => {
      await camera("front");
      await camera("back");
      const [ticket] = await connection.db
        .insert(tickets)
        .values({ ticketNo: "PHOTO-1", plate: "MH12AB1234", language: "en" })
        .returning();

      const result = await app.hardware.photos.requestPhotos(ticket!.id);

      expect(result.failed).toEqual([]);
      for (const [name, kind] of [
        ["front", "FRONT_PLATE"],
        ["back", "BACK_PLATE"],
      ] as const) {
        const photo = result.photos[name]!;
        const bytes = await readFile(join(folder, photo.storagePath));
        // Re-encoded by the image pipeline: the same picture, and the hash is of the saved file.
        const { dominant } = await sharp(bytes).stats();
        expect(dominant.r > dominant.b).toBe(name === "front");
        expect(photo.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        const [row] = await connection.db.select().from(photos).where(eq(photos.id, photo.id));
        expect(row).toMatchObject({ ticketId: ticket!.id, kind, sha256: photo.sha256 });
      }
    });

    it("works before a ticket exists", async () => {
      await camera("front");
      await camera("back");
      const result = await app.hardware.photos.requestPhotos(null);
      const [row] = await connection.db
        .select()
        .from(photos)
        .where(eq(photos.id, result.photos.front!.id));
      expect(row!.ticketId).toBeNull();
    });

    it("sends each camera its own photo id", async () => {
      const front = await camera("front");
      const back = await camera("back");
      await app.hardware.photos.requestPhotos(null);
      expect(snapIds(front)).toHaveLength(1);
      expect(snapIds(front)[0]).not.toBe(snapIds(back)[0]);
    });

    it("returns one photo and says which camera never answered, after one retry", async () => {
      await camera("front");
      const silent = await camera("back", () => {});
      const started = Date.now();

      const result = await app.hardware.photos.requestPhotos(null);

      expect(result.photos.front).toBeDefined();
      expect(result.photos.back).toBeUndefined();
      expect(result.failed).toEqual([{ camera: "back", reason: "TIMEOUT" }]);
      expect(Date.now() - started).toBeGreaterThanOrEqual(TIMEOUT_MS * 2 - 20);
      // Asked twice, with the same id.
      expect(snapIds(silent)).toHaveLength(2);
      expect(new Set(snapIds(silent)).size).toBe(1);
    });

    it("succeeds when a camera answers only the second time", async () => {
      await camera("front");
      const slow = await camera("back", (id, snap) => {
        if (snap === 2) void upload(id, jpeg("back"), TEST_DEVICE_TOKENS.back);
      });

      const result = await app.hardware.photos.requestPhotos(null);

      expect(result.failed).toEqual([]);
      expect(result.photos.back).toBeDefined();
      expect(snapIds(slow)).toHaveLength(2);
    });

    it("says OFFLINE at once for a camera that is not connected", async () => {
      await camera("front");
      const started = Date.now();

      const result = await app.hardware.photos.requestPhotos(null);

      expect(result.failed).toEqual([{ camera: "back", reason: "OFFLINE" }]);
      expect(Date.now() - started).toBeLessThan(TIMEOUT_MS * 2);
    });

    it("says both are offline when no camera is connected", async () => {
      expect(await app.hardware.photos.requestPhotos(null)).toEqual({
        photos: {},
        failed: [
          { camera: "front", reason: "OFFLINE" },
          { camera: "back", reason: "OFFLINE" },
        ],
      });
    });

    it("says SAVE_FAILED when the photo cannot be saved", async () => {
      await camera("front");
      await camera("back");
      // No such ticket, so the database refuses the photo rows.
      const result = await app.hardware.photos.requestPhotos(999_999);
      expect(result.failed.map((f) => f.reason)).toEqual(["SAVE_FAILED", "SAVE_FAILED"]);
    });
  });

  describe("POST /api/device/photo/:photoId", () => {
    /** Starts a request that nothing answers by itself, and gives the two ids. */
    async function openRequest() {
      const front = await camera("front", () => {});
      const back = await camera("back", () => {});
      const done = app.hardware.photos.requestPhotos(null);
      await waitFor(() => snapIds(front).length > 0 && snapIds(back).length > 0);
      return { frontId: snapIds(front)[0]!, backId: snapIds(back)[0]!, done };
    }

    it("refuses a photo id that was already used", async () => {
      const { frontId, done } = await openRequest();

      expect((await upload(frontId)).statusCode).toBe(201);
      const again = await upload(frontId, jpeg("another"));
      expect(again.statusCode).toBe(404);
      expect(again.json().error.code).toBe("UNKNOWN_PHOTO_ID");
      await done;
      expect((await upload(frontId)).statusCode).toBe(404);
    });

    it("accepts only one of two uploads that arrive together", async () => {
      const { frontId, done } = await openRequest();
      const statuses = (await Promise.all([upload(frontId), upload(frontId)])).map(
        (r) => r.statusCode,
      );
      expect(statuses.sort()).toEqual([201, 404]);
      await done;
    });

    it("refuses the other camera's id, which stays usable by the right one", async () => {
      const { frontId, done } = await openRequest();

      const wrong = await upload(frontId, jpeg(), TEST_DEVICE_TOKENS.back);
      expect(wrong.statusCode).toBe(403);
      expect(wrong.json().error.code).toBe("WRONG_CAMERA");
      expect((await upload(frontId)).statusCode).toBe(201);
      await done;
    });

    it("refuses an id after the request has given up", async () => {
      const { frontId, done } = await openRequest();
      await done;
      expect((await upload(frontId)).json().error.code).toBe("UNKNOWN_PHOTO_ID");
    });

    it.each([randomUUID(), "not-a-uuid"])("refuses the made-up id %s", async (id) => {
      expect((await upload(id)).statusCode).toBe(404);
    });

    it.each([
      ["no token", "", 401, "INVALID_DEVICE_TOKEN"],
      ["a wrong token", "wrong-token-of-some-length", 401, "INVALID_DEVICE_TOKEN"],
      ["the main ESP32's token", TEST_DEVICE_TOKENS.main, 403, "WRONG_DEVICE"],
    ])("refuses an upload with %s", async (_label, token, status, code) => {
      const response = await upload(randomUUID(), jpeg(), token || null);
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(code);
    });

    it.each([
      ["a PNG type", "image/png"],
      ["JSON", "application/json"],
      ["text", "text/plain"],
      ["a form", "multipart/form-data; boundary=x"],
    ])("refuses %s", async (_label, type) => {
      const response = await upload(randomUUID(), jpeg(), TEST_DEVICE_TOKENS.front, type);
      expect(response.statusCode).toBe(415);
    });

    it("reports a damaged JPEG as not saved", async () => {
      const { frontId, backId, done } = await openRequest();
      const damaged = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("junk")]);

      expect((await upload(frontId, damaged)).json().error.code).toBe("INVALID_IMAGE");
      await upload(backId, jpeg(), TEST_DEVICE_TOKENS.back);
      expect((await done).failed).toEqual([{ camera: "front", reason: "SAVE_FAILED" }]);
    });

    it("refuses bytes that are not a JPEG, and still takes a good photo after", async () => {
      const { frontId, done } = await openRequest();

      expect((await upload(frontId, Buffer.from("hello"))).statusCode).toBe(415);
      expect((await upload(frontId)).statusCode).toBe(201);
      await done;
    });

    it("refuses more than 8 MB", async () => {
      const big = Buffer.concat([jpeg(), Buffer.alloc(MAX_UPLOAD_BYTES)]);
      const response = await upload(randomUUID(), big);
      expect(response.statusCode).toBe(413);
      expect(response.json().error.code).toBe("FILE_TOO_LARGE");
    });
  });
});
