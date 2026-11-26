// readPlates through the real app: pretend cameras upload real pictures, and the
// plate services are pretend.
import type { CameraId } from "@trinetra/shared";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { createDb } from "../../db/client";
import { photos } from "../../db/schema";
import { seedDatabase } from "../../db/seed";
import { resetTestDatabase } from "../../test/database";
import {
  connectDevice,
  deviceTokenEnv,
  TEST_DEVICE_TOKENS,
  waitFor,
  type TestDevice,
} from "../../test/device-client";
import { testDatabaseUrl, testEnv } from "../../test/env";
import { fakeApis, geminiText, plates } from "../../test/fake-apis";
import { LocalStorage } from "../storage";
import { createReaders, loadInvoiceLists } from "./index";

/** A picture per camera; the pretend service tells them apart by size. */
const picture = (width: number) =>
  sharp({ create: { width, height: 40, channels: 3, background: "#777777" } })
    .jpeg()
    .toBuffer();

describe.skipIf(!testDatabaseUrl)("readPlates", { timeout: 30_000 }, () => {
  let folder: string;
  let connection: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  let url: string;
  const devices: TestDevice[] = [];
  const widths: Record<CameraId, number> = { front: 80, back: 120 };

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    connection = createDb(testDatabaseUrl!, { max: 2 });
    await seedDatabase(connection.db);
    folder = await mkdtemp(join(tmpdir(), "trinetra-readers-"));
  }, 60_000);
  afterAll(async () => {
    await connection?.close();
    await rm(folder, { recursive: true, force: true });
  });

  beforeEach(async () => {
    app = await buildApp({
      env: testEnv(deviceTokenEnv),
      storage: new LocalStorage(folder, testEnv().JWT_SECRET),
      hardware: {
        settings: { wakeThresholdKg: 500, stableWindowMs: 3000, stableSpreadKg: 10 },
        photoTimeoutMs: 400,
      },
    });
    url = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterEach(async () => {
    devices.splice(0).forEach((device) => device.socket.terminate());
    await app.close();
  });

  async function camera(name: CameraId) {
    const device = await connectDevice(url, TEST_DEVICE_TOKENS[name]);
    devices.push(device);
    device.socket.on("message", async (data) => {
      const message = JSON.parse(data.toString());
      if (message.t !== "snap") return;
      await app.inject({
        method: "POST",
        url: `/api/device/photo/${message.id}`,
        headers: { "content-type": "image/jpeg", "x-device-token": TEST_DEVICE_TOKENS[name] },
        payload: await picture(widths[name]),
      });
    });
    device.send({ t: "hello", cam: name });
    await waitFor(() => app.hardware.state.isOnline(name));
  }

  /** The readers wired to pretend services that answer by which camera's photo was sent. */
  function readersSeeing(seen: Record<CameraId, string | null>) {
    const apis = fakeApis({
      plateRecognizer: (_n, call) => {
        const answer = async () => {
          const upload = (call.body as FormData).get("upload") as File;
          const { width } = await sharp(Buffer.from(await upload.arrayBuffer())).metadata();
          const plate = seen[width === widths.front ? "front" : "back"];
          return plate ? plates([plate, 0.9]) : plates();
        };
        return answer();
      },
      gemini: () => geminiText('{"plate":null}'),
    });
    const readers = createReaders({
      env: testEnv({ PLATE_RECOGNIZER_TOKEN: "t", GEMINI_API_KEY: "k" }),
      db: connection.db,
      storage: new LocalStorage(folder, testEnv().JWT_SECRET),
      photos: app.hardware.photos,
      log: app.log,
      fetch: apis.fetch,
    });
    return { readers, apis };
  }

  it("returns both plates, the match, the sources and the confidence", async () => {
    await camera("front");
    await camera("back");
    const { readers } = readersSeeing({ front: "mh12ab1234", back: "MH12AB1234" });

    const result = await readers.readPlates(null);

    expect(result).toMatchObject({ match: true, plate: "MH12AB1234", demo: false });
    for (const name of ["front", "back"] as const) {
      expect(result.cameras[name]).toMatchObject({
        plate: "MH12AB1234",
        source: "plate_recognizer",
        confidence: 0.9,
        cameraFailure: null,
      });
      const [row] = await connection.db
        .select()
        .from(photos)
        .where(eq(photos.id, result.cameras[name].photoId!));
      expect(row).toBeDefined();
    }
    // Both calls were counted.
    const today = new Date().toISOString().slice(0, 10);
    expect(await readers.usage.count("plate_recognizer", today)).toBeGreaterThanOrEqual(2);
  });

  it("reports plates that differ, with no agreed plate", async () => {
    await camera("front");
    await camera("back");
    const { readers } = readersSeeing({ front: "MH12AB1234", back: "MH14CD5678" });

    expect(await readers.readPlates(null)).toMatchObject({
      match: false,
      plate: null,
      cameras: { front: { plate: "MH12AB1234" }, back: { plate: "MH14CD5678" } },
    });
  });

  it("does not match two unreadable plates", async () => {
    await camera("front");
    await camera("back");
    const { readers } = readersSeeing({ front: null, back: null });

    const result = await readers.readPlates(null);
    expect(result).toMatchObject({ match: false, plate: null });
    expect(result.cameras.front.source).toBe("gemini");
  });

  it("does not agree on a partial plate, even if both read the same part", async () => {
    await camera("front");
    await camera("back");
    const { readers } = readersSeeing({ front: "MH12AB", back: "MH12AB" });

    expect(await readers.readPlates(null)).toMatchObject({ match: true, plate: null });
  });

  it("reads the camera that answered and says why the other did not", async () => {
    await camera("front");
    const { readers, apis } = readersSeeing({ front: "MH12AB1234", back: null });

    const result = await readers.readPlates(null);

    expect(result).toMatchObject({ match: false, plate: null });
    expect(result.cameras.front.plate).toBe("MH12AB1234");
    expect(result.cameras.back).toMatchObject({
      plate: null,
      photoId: null,
      cameraFailure: "OFFLINE",
    });
    expect(apis.calls.plateRecognizer).toHaveLength(1);
  });

  it("matches invoices against the lists in the database", async () => {
    const lists = await loadInvoiceLists(connection.db);
    expect(lists.materials).toHaveLength(9);
    expect(lists.suppliers).toContain("Shree Ram Crushers");
    expect(lists.transporters).toHaveLength(4);
  });
});
