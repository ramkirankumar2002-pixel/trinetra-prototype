// Plate Recognizer, Gemini and the fallback between them. The network is always pretend.
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { fakeApis, json, plates, geminiText } from "../../test/fake-apis";
import { createGemini } from "./gemini";
import { createPlateReader } from "./plate-reader";
import { createPlateRecognizer } from "./plate-recognizer";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);
const TOKEN = "pr-secret-token-123";
const KEY = "gemini-secret-key-456";

function setup(
  handlers: Parameters<typeof fakeApis>[0],
  options: {
    token?: string | undefined;
    minIntervalMs?: number;
    timeoutMs?: number;
    deadlineMs?: number;
  } = {},
) {
  const apis = fakeApis(handlers);
  const used: string[] = [];
  const usage = { record: async (service: string) => void used.push(service) };
  const warnings: unknown[] = [];
  const log = { warn: (...args: unknown[]) => void warnings.push(args) } as unknown as Pick<
    FastifyBaseLogger,
    "warn"
  >;
  const plateRecognizer = createPlateRecognizer({
    token: "token" in options ? options.token : TOKEN,
    usage,
    fetch: apis.fetch,
    minIntervalMs: options.minIntervalMs ?? 0,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });
  const gemini = createGemini({
    apiKey: KEY,
    model: "gemini-test",
    usage,
    fetch: apis.fetch,
    busyRetryDelaysMs: [1, 1],
  });
  return {
    apis,
    used,
    warnings,
    plateRecognizer,
    gemini,
    read: createPlateReader({
      plateRecognizer,
      gemini,
      log,
      ...(options.deadlineMs ? { deadlineMs: options.deadlineMs } : {}),
    }),
  };
}

describe("Plate Recognizer client", () => {
  it("sends the photo with region India and the token in the header", async () => {
    const { apis, plateRecognizer, used } = setup({
      plateRecognizer: () => plates(["mh12ab1234", 0.91]),
    });

    expect(await plateRecognizer.read(JPEG)).toEqual({ plate: "MH12AB1234", score: 0.91 });

    const [call] = apis.calls.plateRecognizer;
    expect(call!.url).toBe("https://api.platerecognizer.com/v1/plate-reader/");
    expect(call!.url).not.toContain(TOKEN);
    expect(call!.headers.get("authorization")).toBe(`Token ${TOKEN}`);
    const form = call!.body as FormData;
    expect(form.get("regions")).toBe("in");
    const upload = form.get("upload") as File;
    expect(Buffer.from(await upload.arrayBuffer())).toEqual(JPEG);
    expect(used).toEqual(["plate_recognizer"]);
  });

  it("takes the highest score, preferring text shaped like a plate", async () => {
    const { plateRecognizer } = setup({
      plateRecognizer: () => plates(["tatamotors", 0.99], ["mh12ab1234", 0.8], ["mh14cd5678", 0.6]),
    });
    expect(await plateRecognizer.read(JPEG)).toEqual({ plate: "MH12AB1234", score: 0.8 });
  });

  it("keeps the best odd-shaped read when nothing is shaped like a plate", async () => {
    const { plateRecognizer } = setup({
      plateRecognizer: () => plates(["mh12ab", 0.4], ["mh12a", 0.7]),
    });
    expect(await plateRecognizer.read(JPEG)).toEqual({ plate: "MH12A", score: 0.7 });
  });

  it("returns no plate for an empty result", async () => {
    const { plateRecognizer } = setup({ plateRecognizer: () => plates() });
    expect(await plateRecognizer.read(JPEG)).toEqual({ plate: null, score: null });
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["too many requests", () => json({ detail: "throttled" }, 429)],
  ])("tries once more after %s", async (_label, first) => {
    const { apis, plateRecognizer, used } = setup({
      plateRecognizer: (n) => (n === 1 ? first() : plates(["MH12AB1234", 0.9])),
    });
    expect((await plateRecognizer.read(JPEG)).plate).toBe("MH12AB1234");
    expect(apis.calls.plateRecognizer).toHaveLength(2);
    // Every request sent is counted.
    expect(used).toHaveLength(2);
  });

  it("gives up after the second network error", async () => {
    const { apis, plateRecognizer } = setup({
      plateRecognizer: () => Promise.reject(new TypeError(`fetch failed ${TOKEN}`)),
    });
    const error = await plateRecognizer.read(JPEG).catch((e: Error) => e);
    expect(error).toMatchObject({ code: "NETWORK" });
    expect(String(error)).not.toContain(TOKEN);
    expect(apis.calls.plateRecognizer).toHaveLength(2);
  });

  it("times out, and tries once more", async () => {
    const { apis, plateRecognizer } = setup({ plateRecognizer: () => "hang" }, { timeoutMs: 40 });
    await expect(plateRecognizer.read(JPEG)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(apis.calls.plateRecognizer).toHaveLength(2);
  });

  it.each([
    [403, "AUTH_OR_CREDITS"],
    [500, "BUSY"],
    [413, "REQUEST_REFUSED"],
  ])("does not retry HTTP %i", async (status, code) => {
    const { apis, plateRecognizer } = setup({ plateRecognizer: () => json({}, status) });
    await expect(plateRecognizer.read(JPEG)).rejects.toMatchObject({ code });
    expect(apis.calls.plateRecognizer).toHaveLength(1);
  });

  it("refuses an answer of the wrong shape", async () => {
    const { plateRecognizer } = setup({ plateRecognizer: () => json({ results: "none" }, 201) });
    await expect(plateRecognizer.read(JPEG)).rejects.toMatchObject({ code: "BAD_ANSWER" });
  });

  it("sends nothing without a token", async () => {
    const { apis, plateRecognizer } = setup({}, { token: undefined });
    await expect(plateRecognizer.read(JPEG)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(apis.calls.plateRecognizer).toHaveLength(0);
  });

  it("spaces out two photos sent at the same time (free plan: 1 a second)", async () => {
    const starts: number[] = [];
    const { plateRecognizer } = setup(
      {
        plateRecognizer: () => {
          starts.push(Date.now());
          return plates(["MH12AB1234", 0.9]);
        },
      },
      { minIntervalMs: 150 },
    );
    await Promise.all([plateRecognizer.read(JPEG), plateRecognizer.read(JPEG)]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(140);
  });
});

describe("Gemini client", () => {
  const ask = (gemini: ReturnType<typeof setup>["gemini"]) =>
    gemini.generateJson({
      parts: [{ type: "text", text: "hi" }],
      schema: { type: "object" },
      validate: { safeParse: (v: unknown) => ({ success: true, data: v }) } as never,
    });

  it("asks for structured JSON, stores nothing, and keeps the key in a header", async () => {
    const { apis, gemini } = setup({ gemini: () => geminiText('{"a":1}') });

    expect(await ask(gemini)).toEqual({ data: { a: 1 }, model: "gemini-test" });

    const [call] = apis.calls.gemini;
    expect(call!.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(call!.headers.get("x-goog-api-key")).toBe(KEY);
    expect(JSON.parse(call!.body as string)).toEqual({
      model: "gemini-test",
      store: false,
      input: [{ type: "text", text: "hi" }],
      response_format: { type: "text", mime_type: "application/json", schema: { type: "object" } },
    });
  });

  it("retries when Google says it is busy", async () => {
    const { apis, gemini } = setup({
      gemini: (n) => (n < 3 ? json({ error: { message: "high demand" } }, 503) : geminiText("{}")),
    });
    expect(await ask(gemini)).toMatchObject({ data: {} });
    expect(apis.calls.gemini).toHaveLength(3);
  });

  it("stops after two busy retries", async () => {
    const { apis, gemini } = setup({ gemini: () => json({}, 503) });
    await expect(ask(gemini)).rejects.toMatchObject({ code: "BUSY" });
    expect(apis.calls.gemini).toHaveLength(3);
  });

  it.each([
    [429, "RATE_LIMITED"],
    [403, "AUTH_OR_CREDITS"],
    [400, "REQUEST_REFUSED"],
  ])("does not retry HTTP %i, and never repeats the key", async (status, code) => {
    const { apis, gemini } = setup({
      gemini: () => json({ error: { message: `bad key ${KEY}` } }, status),
    });
    const error = await ask(gemini).catch((e: Error) => e);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(KEY);
    expect(apis.calls.gemini).toHaveLength(1);
  });

  it("retries one network error", async () => {
    const { apis, gemini } = setup({
      gemini: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(ask(gemini)).rejects.toMatchObject({ code: "NETWORK" });
    expect(apis.calls.gemini).toHaveLength(2);
  });

  it.each([
    ["text that is not JSON", geminiText("sorry")],
    ["no model output", json({ status: "completed", steps: [{ type: "user_input" }] })],
    ["another shape", json({ candidates: [] })],
  ])("refuses an answer with %s", async (_label, answer) => {
    const { gemini } = setup({ gemini: () => answer.clone() });
    await expect(ask(gemini)).rejects.toMatchObject({ code: "BAD_ANSWER" });
  });
});

describe("plate reader with Gemini fallback", () => {
  const geminiPlate = (plate: string | null) => () => geminiText(JSON.stringify({ plate }));

  it("uses Plate Recognizer and does not call Gemini when a plate is found", async () => {
    const { apis, read } = setup({ plateRecognizer: () => plates(["MH12AB1234", 0.93]) });

    expect(await read(JPEG)).toEqual({
      plate: "MH12AB1234",
      source: "plate_recognizer",
      model: null,
      confidence: 0.93,
      validFormat: true,
      ms: expect.any(Number),
      problems: [],
    });
    expect(apis.calls.gemini).toHaveLength(0);
  });

  it("asks Gemini about the same photo when no plate is found", async () => {
    const { apis, read } = setup({
      plateRecognizer: () => plates(),
      gemini: geminiPlate("MH 12 AB 1234"),
    });

    expect(await read(JPEG)).toMatchObject({
      plate: "MH12AB1234",
      source: "gemini",
      model: "gemini-test",
      confidence: null,
      validFormat: true,
      problems: [],
    });
    const sent = JSON.parse(apis.calls.gemini[0]!.body as string);
    expect(sent.input[0]).toEqual({
      type: "image",
      mime_type: "image/jpeg",
      data: JPEG.toString("base64"),
    });
    expect(sent.input[1].text).toMatch(/Never guess/);
  });

  it("falls back to Gemini when Plate Recognizer fails, and says so", async () => {
    const { read, warnings } = setup({
      plateRecognizer: () => json({}, 403),
      gemini: geminiPlate("MH14CD5678"),
    });
    expect(await read(JPEG)).toMatchObject({
      plate: "MH14CD5678",
      source: "gemini",
      problems: [{ service: "plate_recognizer", code: "AUTH_OR_CREDITS" }],
    });
    expect(JSON.stringify(warnings)).not.toContain(TOKEN);
  });

  it.each([null, "", "MH12AB", "unreadable", "MH12AB12??"])(
    "treats Gemini answering %j as unread",
    async (answer) => {
      const { read } = setup({ plateRecognizer: () => plates(), gemini: geminiPlate(answer) });
      expect(await read(JPEG)).toMatchObject({ plate: null, source: "gemini", validFormat: false });
    },
  );

  it("returns no plate, without throwing, when both fail", async () => {
    const { read } = setup({
      plateRecognizer: () => json({}, 500),
      gemini: () => json({}, 429),
    });
    expect(await read(JPEG)).toMatchObject({
      plate: null,
      source: null,
      confidence: null,
      problems: [
        { service: "plate_recognizer", code: "BUSY" },
        { service: "gemini", code: "RATE_LIMITED" },
      ],
    });
  });

  it("marks a partial Plate Recognizer read as not a plate", async () => {
    const { read } = setup({ plateRecognizer: () => plates(["MH12AB", 0.5]) });
    expect(await read(JPEG)).toMatchObject({ plate: "MH12AB", validFormat: false });
  });

  it("does not hide a programming error", async () => {
    const { read, plateRecognizer } = setup({});
    vi.spyOn(plateRecognizer, "read").mockRejectedValue(new TypeError("bug"));
    await expect(read(JPEG)).rejects.toThrow("bug");
  });
});

describe("the deadline for one plate", () => {
  it("gives up on a reading that takes too long, and says which service was asked", async () => {
    const { read } = setup(
      { plateRecognizer: () => new Promise<Response>(() => {}) },
      { deadlineMs: 30, timeoutMs: 60_000 },
    );
    expect(await read(JPEG)).toMatchObject({
      plate: null,
      source: null,
      problems: [{ service: "plate_recognizer", code: "TIMEOUT" }],
    });
  });
});
