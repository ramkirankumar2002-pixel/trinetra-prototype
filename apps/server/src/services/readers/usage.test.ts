import type { FastifyBaseLogger } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../db/client";
import { settings } from "../../db/schema";
import { resetTestDatabase } from "../../test/database";
import { testDatabaseUrl } from "../../test/env";
import { createUsageCounter, GEMINI_DAILY_WARNING } from "./usage";

describe.skipIf(!testDatabaseUrl)("API usage counter", { timeout: 30_000 }, () => {
  let connection: ReturnType<typeof createDb>;
  let day = "2026-11-26";
  const warnings: { message: string; data: object }[] = [];
  const log = {
    warn: (data: object, message: string) => void warnings.push({ data, message }),
  } as unknown as Pick<FastifyBaseLogger, "warn">;
  const counter = () => createUsageCounter(connection.db, log, () => new Date(`${day}T10:00:00Z`));

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    connection = createDb(testDatabaseUrl!, { max: 3 });
  }, 60_000);
  afterAll(() => connection?.close());
  beforeEach(async () => {
    warnings.length = 0;
    day = "2026-11-26";
    await connection.db.delete(settings);
  });

  const put = (key: string, value: number) => connection.db.insert(settings).values({ key, value });

  it("counts calls per service and per day, including calls made together", async () => {
    await Promise.all(Array.from({ length: 5 }, () => counter().record("plate_recognizer")));
    await counter().record("gemini");
    day = "2026-11-27";
    await counter().record("plate_recognizer");

    expect(await counter().count("plate_recognizer", "2026-11-26")).toBe(5);
    expect(await counter().count("plate_recognizer", "2026-11")).toBe(6);
    expect(await counter().count("gemini", "2026-11")).toBe(1);
    expect(warnings).toEqual([]);
  });

  it("warns from 80 % of Plate Recognizer's 2,500 a month", async () => {
    await put("api_usage:plate_recognizer:2026-11-01", 1998);
    await counter().record("plate_recognizer");
    expect(warnings).toEqual([]);

    await counter().record("plate_recognizer");
    expect(warnings).toEqual([
      {
        data: { calls: 2000, limit: 2500 },
        message: "Plate Recognizer: close to this month's free limit",
      },
    ]);
  });

  it("does not count last month", async () => {
    await put("api_usage:plate_recognizer:2026-10-31", 2400);
    await counter().record("plate_recognizer");
    expect(warnings).toEqual([]);
  });

  it("warns about many Gemini calls in one day", async () => {
    await put(`api_usage:gemini:${day}`, GEMINI_DAILY_WARNING * 0.8 - 1);
    await counter().record("gemini");
    expect(warnings[0]!.message).toMatch(/Gemini: many calls today/);
  });

  it("never throws, even if the database is gone", async () => {
    const broken = createDb("postgres://postgres:x@127.0.0.1:1/none_test", { max: 1 });
    await expect(createUsageCounter(broken.db, log).record("gemini")).resolves.toBeUndefined();
    expect(warnings[0]!.message).toBe("could not count an API call");
    await broken.close();
  });
});
