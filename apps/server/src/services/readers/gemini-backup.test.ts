// The automatic backup model. The network is always pretend.
import { SEED_MATERIALS, SEED_SUPPLIERS, SEED_TRANSPORTERS } from "@trinetra/shared/seed";
import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeApis, geminiText, json, plates, type FakeCall } from "../../test/fake-apis";
import { createGemini } from "./gemini";
import { readInvoiceWithGemini } from "./invoice";
import { createPlateReader } from "./plate-reader";
import { createPlateRecognizer } from "./plate-recognizer";

const KEY = "gemini-secret-key-789";
const MAIN = "gemini-main";
const BACKUP = "gemini-backup";

const modelOf = (call: FakeCall) => JSON.parse(call.body as string).model as string;
type Answer = Response | Promise<Response> | "hang";

/** `main` and `backup` say how each model answers its nth request. */
function setup(
  main: (n: number) => Answer,
  backup: (n: number) => Answer = () => geminiText('{"word":"backup"}'),
  options: { fallbackModel?: string; timeoutMs?: number } = { fallbackModel: BACKUP },
) {
  const seen = { [MAIN]: 0, [BACKUP]: 0 } as Record<string, number>;
  const apis = fakeApis({
    gemini: (_n, call) => {
      const model = modelOf(call);
      const n = (seen[model] = (seen[model] ?? 0) + 1);
      return model === BACKUP ? backup(n) : main(n);
    },
  });
  const logs: { level: string; data: Record<string, unknown>; message: string }[] = [];
  const record = (level: string) => (data: Record<string, unknown>, message: string) =>
    void logs.push({ level, data, message });
  const log = { info: record("info"), warn: record("warn") } as unknown as Pick<
    FastifyBaseLogger,
    "info" | "warn"
  >;
  const used: string[] = [];
  const gemini = createGemini({
    apiKey: KEY,
    model: MAIN,
    usage: { record: async (service) => void used.push(service) },
    log,
    fetch: apis.fetch,
    busyRetryDelaysMs: [1, 1],
    timeoutMs: options.timeoutMs ?? 5000,
    ...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
  });
  const ask = () =>
    gemini.generateJson({
      parts: [{ type: "text", text: "hi" }],
      schema: { type: "object" },
      validate: z.object({ word: z.string() }),
    });
  const models = () => apis.calls.gemini.map(modelOf);
  return { gemini, ask, apis, models, logs, used, log };
}

const ok = () => geminiText('{"word":"main"}');
const status = (code: number) => () => json({ error: { message: `problem ${KEY}` } }, code);
const networkDown = () => Promise.reject(new TypeError("fetch failed"));

describe("Gemini backup model", () => {
  it("is not used when the main model answers", async () => {
    const { ask, models, logs } = setup(ok);

    expect(await ask()).toEqual({ data: { word: "main" }, model: MAIN });
    expect(models()).toEqual([MAIN]);
    expect(logs).toEqual([
      { level: "info", data: { model: MAIN, backup: false }, message: "Gemini: answer received" },
    ]);
  });

  it.each([
    [503, "BUSY"],
    [500, "BUSY"],
    [502, "BUSY"],
    [504, "BUSY"],
    [429, "RATE_LIMITED"],
  ])("answers after the main model returns HTTP %i, trying each once", async (code, reason) => {
    const { ask, models, logs, used, apis } = setup(status(code));

    expect(await ask()).toEqual({ data: { word: "backup" }, model: BACKUP });
    expect(models()).toEqual([MAIN, BACKUP]);
    // Both requests are counted.
    expect(used).toEqual(["gemini", "gemini"]);
    expect(logs[0]).toMatchObject({
      level: "warn",
      data: { model: MAIN, backupModel: BACKUP, reason },
      message: "Gemini: trying the backup model",
    });
    expect(logs[1]).toMatchObject({ level: "info", data: { model: BACKUP, backup: true } });
    expect(JSON.stringify(logs)).not.toContain(KEY);
    // The backup gets the very same question.
    const [first, second] = apis.calls.gemini.map((c) => JSON.parse(c.body as string));
    expect(second).toEqual({ ...first, model: BACKUP });
  });

  it("answers after the main model times out", async () => {
    const { ask, models, logs } = setup(() => "hang", undefined, {
      fallbackModel: BACKUP,
      timeoutMs: 40,
    });

    expect(await ask()).toMatchObject({ model: BACKUP });
    expect(models()).toEqual([MAIN, BACKUP]);
    expect(logs[0]!.data.reason).toBe("TIMEOUT");
  });

  it.each([
    [403, "AUTH_OR_CREDITS"],
    [400, "REQUEST_REFUSED"],
    [404, "REQUEST_REFUSED"],
  ])("is not used for HTTP %i", async (code, reason) => {
    const { ask, models } = setup(status(code));
    await expect(ask()).rejects.toMatchObject({ code: reason });
    expect(models()).toEqual([MAIN]);
  });

  it.each(['"sorry"', "not json", '{"other":1}'])(
    "is not used when the main model answers %s",
    async (text) => {
      const { ask, models } = setup(() => geminiText(text));
      await expect(ask()).rejects.toMatchObject({ code: "BAD_ANSWER" });
      expect(models()).toEqual([MAIN]);
    },
  );

  it("retries a network error on the main model, without the backup", async () => {
    const { ask, models } = setup(networkDown);
    await expect(ask()).rejects.toMatchObject({ code: "NETWORK" });
    expect(models()).toEqual([MAIN, MAIN]);
  });

  it("is used if that network retry finds the main model busy", async () => {
    const { ask, models } = setup((n) => (n === 1 ? networkDown() : status(503)()));
    expect(await ask()).toMatchObject({ model: BACKUP });
    expect(models()).toEqual([MAIN, MAIN, BACKUP]);
  });

  it.each([
    ["is busy", status(503), "BUSY"],
    ["is rate limited", status(429), "RATE_LIMITED"],
    ["has a network error", networkDown, "NETWORK"],
    ["gives a bad answer", () => geminiText("sorry"), "BAD_ANSWER"],
  ])("is tried only once when it also %s", async (_label, backup, code) => {
    const { ask, models, logs } = setup(status(503), backup);

    const error = await ask().catch((e: Error) => e);

    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(KEY);
    expect(models()).toEqual([MAIN, BACKUP]);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it.each([
    ["no backup is set", {}],
    ["the backup has the same name", { fallbackModel: MAIN }],
  ])("keeps the old retries when %s", async (_label, options) => {
    const { ask, models, gemini } = setup(status(503), undefined, options);

    expect(gemini.fallbackModel).toBeUndefined();
    await expect(ask()).rejects.toMatchObject({ code: "BUSY" });
    expect(models()).toEqual([MAIN, MAIN, MAIN]);
  });

  it("is recorded in a plate result", async () => {
    const { gemini, log, apis } = setup(status(503), () => geminiText('{"plate":"MH12AB1234"}'));
    const recognizer = fakeApis({ plateRecognizer: () => plates() });
    const readPlate = createPlateReader({
      plateRecognizer: createPlateRecognizer({
        token: "t",
        usage: { record: async () => {} },
        fetch: recognizer.fetch,
        minIntervalMs: 0,
      }),
      gemini,
      log,
    });

    expect(await readPlate(Buffer.from("jpeg"))).toMatchObject({
      plate: "MH12AB1234",
      source: "gemini",
      model: BACKUP,
      // The backup succeeded, so nothing failed as far as the caller is concerned.
      problems: [],
    });
    expect(apis.calls.gemini).toHaveLength(2);
  });

  it("is recorded in an invoice result", async () => {
    const empty = Object.fromEntries(
      [
        "invoice_number",
        "invoice_date",
        "supplier",
        "transporter",
        "vehicle_number",
        "material",
        "quantity",
        "quantity_unit",
      ].map((name) => [name, null]),
    );
    const { gemini } = setup(status(429), () => geminiText(JSON.stringify(empty)));

    const read = await readInvoiceWithGemini(
      gemini,
      { data: Buffer.from("x"), contentType: "image/jpeg" },
      {
        lists: {
          materials: SEED_MATERIALS,
          suppliers: [...SEED_SUPPLIERS],
          transporters: [...SEED_TRANSPORTERS],
        },
        ticketPlate: null,
      },
    );
    expect(read).toMatchObject({ source: "gemini", model: BACKUP });
  });
});
