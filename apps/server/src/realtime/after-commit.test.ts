// Against the real test database: what is sent when a transaction commits or not.
import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { createDb } from "../db/client";
import { settings } from "../db/schema";
import { resetTestDatabase } from "../test/database";
import { waitFor } from "../test/device-client";
import { testDatabaseUrl, testEnv } from "../test/env";
import { connectLive, socketToken } from "../test/live-client";
import { createEventTransaction, emitAfterCommit } from "./after-commit";
import type { OutgoingEvent } from "./publish";

const update = (ticketId: number) => ({ ticketId, status: "READY_FOR_SECOND" }) as const;

describe.skipIf(!testDatabaseUrl)("emitAfterCommit", { timeout: 30_000 }, () => {
  let main: ReturnType<typeof createDb>;
  let other: ReturnType<typeof createDb>;
  const sent: OutgoingEvent[] = [];
  const errors: unknown[] = [];
  let publishFails = false;
  let transaction: ReturnType<typeof createEventTransaction>;

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    main = createDb(testDatabaseUrl!, { max: 3 });
    other = createDb(testDatabaseUrl!, { max: 1 });
    // A rule checked only at COMMIT, to make a commit itself fail.
    await main.sql.unsafe(
      "create table commit_check (user_id integer references users(id) deferrable initially deferred)",
    );
    transaction = createEventTransaction(
      main.db,
      (event, rooms, payload) => {
        if (publishFails) throw new Error("the network is gone");
        sent.push({ event, rooms, payload });
      },
      { error: (entry: unknown) => void errors.push(entry) } as unknown as FastifyBaseLogger,
    );
  }, 60_000);

  beforeEach(async () => {
    sent.length = 0;
    errors.length = 0;
    publishFails = false;
    await main.db.delete(settings);
  });

  afterAll(async () => {
    await main?.close();
    await other?.close();
  });

  const save = (tx: Parameters<Parameters<typeof transaction>[0]>[0], key: string) =>
    tx.insert(settings).values({ key, value: 1 });
  const isSaved = async (key: string) =>
    (await other.db.select().from(settings).where(eq(settings.key, key))).length === 1;
  const sentTickets = () => sent.map((e) => (e.payload as { ticketId: number }).ticketId);

  it("sends only after the commit, in order", async () => {
    const result = await transaction(async (tx) => {
      await save(tx, "a");
      emitAfterCommit("ticket:updated", ["kiosk"], update(1));
      emitAfterCommit("ticket:updated", ["store"], update(2));
      // Still inside: nothing has gone out, and others cannot see the change.
      expect(sent).toEqual([]);
      expect(await isSaved("a")).toBe(false);
      return "done";
    });

    expect(result).toBe("done");
    expect(await isSaved("a")).toBe(true);
    expect(sentTickets()).toEqual([1, 2]);
    expect(sent[0]).toEqual({ event: "ticket:updated", rooms: ["kiosk"], payload: update(1) });
  });

  it("sends nothing when the work throws", async () => {
    await expect(
      transaction(async (tx) => {
        await save(tx, "a");
        emitAfterCommit("ticket:updated", ["kiosk"], update(1));
        throw new Error("changed my mind");
      }),
    ).rejects.toThrow("changed my mind");

    expect(sent).toEqual([]);
    expect(await isSaved("a")).toBe(false);
  });

  it("sends nothing after tx.rollback()", async () => {
    await expect(
      transaction(async (tx) => {
        emitAfterCommit("ticket:updated", ["kiosk"], update(1));
        tx.rollback();
      }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("sends nothing when the database refuses a query", async () => {
    await expect(
      transaction(async (tx) => {
        await save(tx, "a");
        emitAfterCommit("ticket:updated", ["kiosk"], update(1));
        await save(tx, "a");
      }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("sends nothing when the COMMIT itself fails", async () => {
    await expect(
      transaction(async (tx) => {
        await save(tx, "a");
        // Accepted here; refused only when committing.
        await tx.execute("insert into commit_check values (999999)");
        emitAfterCommit("ticket:updated", ["kiosk"], update(1));
      }),
    ).rejects.toThrow();

    expect(sent).toEqual([]);
    expect(await isSaved("a")).toBe(false);
  });

  it("holds a nested transaction's events until the outer commit", async () => {
    await transaction(async () => {
      await transaction(async (tx) => {
        await save(tx, "inner");
        emitAfterCommit("ticket:updated", ["kiosk"], update(1));
      });
      expect(sent).toEqual([]);
      emitAfterCommit("ticket:updated", ["kiosk"], update(2));
    });

    expect(sentTickets()).toEqual([1, 2]);
    expect(await isSaved("inner")).toBe(true);
  });

  it("drops only the nested events when only the nested part rolls back", async () => {
    await transaction(async (tx) => {
      await save(tx, "outer");
      emitAfterCommit("ticket:updated", ["kiosk"], update(1));
      await expect(
        transaction(async (inner) => {
          await save(inner, "inner");
          emitAfterCommit("ticket:updated", ["kiosk"], update(2));
          throw new Error("only this part");
        }),
      ).rejects.toThrow();
    });

    expect(sentTickets()).toEqual([1]);
    expect(await isSaved("outer")).toBe(true);
    expect(await isSaved("inner")).toBe(false);
  });

  it("drops nested events when the outer transaction rolls back", async () => {
    await expect(
      transaction(async () => {
        await transaction(async () => emitAfterCommit("ticket:updated", ["kiosk"], update(1)));
        throw new Error("outer");
      }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("keeps the events of transactions running at the same time apart", async () => {
    let failSecond!: () => void;
    const gate = new Promise<void>((resolve) => (failSecond = resolve));
    const good = transaction(async () => {
      emitAfterCommit("ticket:updated", ["kiosk"], update(1));
      await gate;
    });
    const bad = transaction(async () => {
      emitAfterCommit("ticket:updated", ["kiosk"], update(2));
      failSecond();
      throw new Error("bad");
    });

    await expect(bad).rejects.toThrow("bad");
    await good;
    expect(sentTickets()).toEqual([1]);
  });

  it("throws outside a transaction instead of losing the event", () => {
    expect(() => emitAfterCommit("ticket:updated", ["kiosk"], update(1))).toThrow(
      /outside eventTransaction/,
    );
  });

  it("throws for work left running after the transaction ended", async () => {
    let late!: Promise<void>;
    let release!: () => void;
    const finished = new Promise<void>((resolve) => (release = resolve));
    await transaction(async () => {
      late = finished.then(() => emitAfterCommit("ticket:updated", ["kiosk"], update(1)));
    });
    release();
    await expect(late).rejects.toThrow(/outside eventTransaction/);
  });

  it("rolls the change back for a wrong audience or no room", async () => {
    for (const rooms of [["live"], []] as const) {
      await expect(
        transaction(async (tx) => {
          await save(tx, "a");
          emitAfterCommit("approval:new", rooms, { approvalId: 1, ticketId: 1, kind: "HOLD" });
        }),
      ).rejects.toThrow();
      expect(await isSaved("a")).toBe(false);
    }
  });

  it("sends the values as they were when queued", async () => {
    const payload = { ticketId: 1, status: "HOLD_PENDING" as const };
    const rooms: ("kiosk" | "store")[] = ["kiosk"];
    await transaction(async () => {
      emitAfterCommit("ticket:updated", rooms, payload);
      payload.ticketId = 99;
      rooms.push("store");
    });
    expect(sent).toEqual([
      { event: "ticket:updated", rooms: ["kiosk"], payload: { ...payload, ticketId: 1 } },
    ]);
  });

  it("still succeeds if sending fails after the commit, and logs it", async () => {
    publishFails = true;
    await transaction(async (tx) => {
      await save(tx, "a");
      emitAfterCommit("ticket:updated", ["kiosk"], update(1));
    });

    expect(await isSaved("a")).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it("reaches two browser tabs at once through the running app", async () => {
    const app = await buildApp({
      env: testEnv(),
      hardware: {
        settings: {
          wakeThresholdKg: 500,
          stableWindowMs: 3000,
          stableSpreadKg: 10,
          modelScaleKgPerG: 100,
        },
      },
    });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const tabs = await Promise.all(
      [1, 2].map(() => connectLive(url, { token: socketToken(app, "KIOSK") })),
    );
    const received = () => tabs.map((tab) => tab.named("ticket:updated").length);

    await expect(
      app.eventTransaction(async () => {
        emitAfterCommit("ticket:updated", ["kiosk"], update(1));
        throw new Error("rolled back");
      }),
    ).rejects.toThrow();
    await app.eventTransaction(async () => emitAfterCommit("ticket:updated", ["kiosk"], update(2)));
    await waitFor(() => received().every((count) => count > 0));

    for (const tab of tabs) expect(tab.named("ticket:updated")).toEqual([update(2)]);
    tabs.forEach((tab) => tab.socket.close());
    await app.close();
  });
});
