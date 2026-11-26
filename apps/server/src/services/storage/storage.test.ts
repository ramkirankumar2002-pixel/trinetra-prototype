import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app";
import { testEnv } from "../../test/env";
import { createStorage, LocalStorage, SupabaseStorage } from ".";

const photo = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 4]);

let folder: string;
let time = Date.now();
let storage: LocalStorage;
let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "trinetra-storage-"));
  storage = new LocalStorage(folder, testEnv().JWT_SECRET, () => time);
  app = await buildApp({
    env: testEnv(),
    storage,
    logger: { write: (line: string) => void logLines.push(line) },
  });
});
afterAll(async () => {
  await app.close();
  await rm(folder, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: "GET", url });

describe("local storage: save", () => {
  it("writes the file and returns its path and SHA-256", async () => {
    const saved = await storage.save(photo, "tickets/1/front.jpg", "image/jpeg");

    expect(saved).toEqual({
      path: "tickets/1/front.jpg",
      sha256: createHash("sha256").update(photo).digest("hex"),
    });
    expect(await readFile(join(folder, "tickets", "1", "front.jpg"))).toEqual(photo);
  });

  it("reads a saved file back, and refuses an unsafe path", async () => {
    await storage.save(photo, "read/a.jpg", "image/jpeg");
    expect(await storage.read("read/a.jpg")).toEqual(photo);
    await expect(storage.read("../a.jpg")).rejects.toThrow(/storage path/);
  });

  it("never overwrites a saved file", async () => {
    await storage.save(photo, "once.jpg", "image/jpeg");
    await expect(
      storage.save(Buffer.from("other"), "once.jpg", "image/jpeg"),
    ).rejects.toMatchObject({ code: "FILE_EXISTS" });
    expect(await readFile(join(folder, "once.jpg"))).toEqual(photo);
  });

  it.each([
    "../outside.jpg",
    "a/../../outside.jpg",
    "/etc/outside.jpg",
    "C:/outside.jpg",
    "a\\..\\outside.jpg",
    "a//b.jpg",
    ".hidden.jpg",
    "page.html",
    "no-extension",
    "a b.jpg",
  ])("refuses the path %s", async (path) => {
    await expect(storage.save(photo, path, "image/jpeg")).rejects.toThrow(/storage path/);
    await expect(storage.getUrl(path, 60)).rejects.toThrow(/storage path/);
  });

  it("refuses a type that does not match the extension", async () => {
    await expect(storage.save(photo, "x.pdf", "image/jpeg")).rejects.toThrow(/does not match/);
  });
});

describe("local storage: signed links", () => {
  beforeAll(() => storage.save(photo, "links/a.jpg", "image/jpeg").then(() => {}));

  it("serves the file through its signed link without a login", async () => {
    const url = await storage.getUrl("links/a.jpg", 60);
    expect(url).toMatch(/^\/api\/files\/links\/a\.jpg\?expires=\d+&sig=[\w-]+$/);

    const response = await get(url);
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(photo);
    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("stops working when it expires", async () => {
    const url = await storage.getUrl("links/a.jpg", 60);
    time += 59_000;
    expect((await get(url)).statusCode).toBe(200);

    time += 2_000;
    const response = await get(url);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("LINK_EXPIRED");
  });

  it.each([
    ["no signature", (url: string) => url.split("?")[0]!],
    ["a changed signature", (url: string) => url.replace(/sig=.{4}/, "sig=AAAA")],
    ["a longer expiry", (url: string) => url.replace(/expires=\d+/, "expires=9999999999")],
    ["another file name", (url: string) => url.replace("a.jpg", "b.jpg")],
    ["an escape from the folder", (url: string) => url.replace("links/a.jpg", "%2e%2e%2fa.jpg")],
  ])("refuses a link with %s", async (_label, change) => {
    const response = await get(change(await storage.getUrl("links/a.jpg", 60)));
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("INVALID_LINK");
  });

  it("answers 404 for a signed link to a missing file", async () => {
    expect((await get(await storage.getUrl("links/missing.jpg", 60))).statusCode).toBe(404);
  });

  it("keeps the signature out of the log", async () => {
    logLines.length = 0;
    const url = await storage.getUrl("links/a.jpg", 60);
    await get(url);

    expect(logLines.join("")).toContain("links/a.jpg");
    expect(logLines.join("")).not.toContain(url.split("sig=")[1]);
  });

  it.each([0, -5, 3601, 1.5])("refuses an expiry of %s seconds", async (seconds) => {
    await expect(storage.getUrl("links/a.jpg", seconds)).rejects.toThrow(/expire/);
  });
});

describe("createStorage", () => {
  it("uses the local driver for STORAGE_DRIVER=local", () => {
    expect(createStorage(testEnv())).toBeInstanceOf(LocalStorage);
  });

  // Only builds the driver. Real Supabase calls are tested in Phase 16.
  it("uses the Supabase driver for STORAGE_DRIVER=supabase", () => {
    const env = testEnv({
      STORAGE_DRIVER: "supabase",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_KEY: "not-a-real-key",
      STORAGE_BUCKET: "photos",
    });
    expect(createStorage(env)).toBeInstanceOf(SupabaseStorage);
  });
});
