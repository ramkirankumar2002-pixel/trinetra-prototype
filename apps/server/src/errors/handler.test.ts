import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildApp } from "../app";
import { MAX_UPLOAD_BYTES } from "../config/limits";
import { readUpload } from "../http/upload";
import { testEnv } from "../test/env";
import { AppError } from "./app-error";

let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  app = await buildApp({
    env: testEnv(),
    logger: { write: (line: string) => void logLines.push(line) },
  });
  // Routes that exist only in this test, to produce each kind of failure.
  app.post("/x/validate", async (request) =>
    z.object({ name: z.string(), trip: z.object({ no: z.number() }) }).parse(request.body),
  );
  app.get("/x/known", async () => {
    throw new AppError(409, "WRONG_STAGE", "Not allowed now.");
  });
  app.get("/x/unknown", async () => {
    throw new Error("password=hunter2 leaked from the database");
  });
  app.get("/x/sneaky", async () => {
    throw Object.assign(new Error("internal detail"), { statusCode: 400 });
  });
  app.get(
    "/x/limited",
    { config: { rateLimit: { max: 1, timeWindow: "1 minute" } } },
    async () => ({
      ok: true,
    }),
  );
  app.post("/x/upload", async (request) => {
    const { buffer, contentType } = await readUpload(request);
    return { contentType, bytes: buffer.length };
  });
});
afterAll(() => app.close());

/** Builds a multipart body with one file. */
function fileRequest(contentType: string, data: Buffer) {
  const boundary = "trinetra-test-boundary";
  return {
    method: "POST" as const,
    url: "/x/upload",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

const jpeg = (size: number) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(size - 3)]);

describe("error format", () => {
  it("turns validation errors into 400 with the failing fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/x/validate",
      payload: { trip: { no: "one" } },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(response.json().error.details.map((d: { field: string }) => d.field)).toEqual([
      "name",
      "trip.no",
    ]);
  });

  it("keeps the status and code of a known error", async () => {
    const response = await app.inject({ method: "GET", url: "/x/known" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: "WRONG_STAGE", message: "Not allowed now." },
    });
  });

  it.each(["/x/unknown", "/x/sneaky"])("hides the details of %s, but logs them", async (url) => {
    logLines.length = 0;
    const response = await app.inject({ method: "GET", url });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on the server." },
    });
    expect(logLines.join("")).toContain("unexpected error");
  });

  it("answers 404 for an unknown address", async () => {
    const response = await app.inject({ method: "GET", url: "/api/nothing" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("answers 400 for broken JSON", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/x/validate",
      headers: { "content-type": "application/json" },
      payload: "{broken",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BAD_REQUEST");
  });

  it("answers 400 for a badly encoded address", async () => {
    const response = await app.inject({ method: "GET", url: "/api/%c0" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("BAD_REQUEST");
  });

  it("answers 429 in the same format when rate limited", async () => {
    await app.inject({ method: "GET", url: "/x/limited" });
    const response = await app.inject({ method: "GET", url: "/x/limited" });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe("RATE_LIMITED");
  });
});

describe("uploads", () => {
  it.each([
    ["image/jpeg", jpeg(100)],
    ["application/pdf", Buffer.from("%PDF-1.7\n...")],
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    ["image/webp", Buffer.from("RIFF0000WEBPVP8 ")],
  ])("accepts %s", async (type, data) => {
    const response = await app.inject(fileRequest(type, data));
    expect(response.json()).toEqual({ contentType: type, bytes: data.length });
  });

  it.each([
    ["text/plain", Buffer.from("hello")],
    ["image/svg+xml", Buffer.from("<svg/>")],
    ["image/jpeg", Buffer.from("<script>not a photo</script>")],
  ])("refuses a wrong file sent as %s", async (type, data) => {
    const response = await app.inject(fileRequest(type, data));
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("accepts exactly 8 MB and refuses one byte more", async () => {
    const limit = await app.inject(fileRequest("image/jpeg", jpeg(MAX_UPLOAD_BYTES)));
    expect(limit.statusCode).toBe(200);

    const over = await app.inject(fileRequest("image/jpeg", jpeg(MAX_UPLOAD_BYTES + 1)));
    expect(over.statusCode).toBe(413);
    expect(over.json().error.code).toBe("FILE_TOO_LARGE");
  });
});
