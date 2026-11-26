// Runs against TEST_DATABASE_URL: it wipes that database, applies the real migrations,
// and checks that the database itself refuses bad data.
import { CLOSED_TICKET_STATUSES, TICKET_STATUSES, type TicketStatus } from "@trinetra/shared";
import { SEED_USERS } from "@trinetra/shared/seed";
import bcrypt from "bcrypt";
import { eq, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { loadEnv } from "./env";
import * as schema from "./schema";
import { seedDatabase } from "./seed";
import { resetTestDatabase } from "../test/database";

loadEnv();
const url = process.env.TEST_DATABASE_URL;
if (!url) console.warn("TEST_DATABASE_URL is not set: the database tests are SKIPPED.");

/** Expects the query to fail because of the named database constraint (or error code). */
async function expectRefused(query: PromiseLike<unknown>, expected: string): Promise<void> {
  const error: unknown = await Promise.resolve(query).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, `expected the database to refuse this (${expected})`).toBeDefined();
  const cause = (error as { cause?: { constraint_name?: string; code?: string } }).cause;
  expect([cause?.constraint_name, cause?.code]).toContain(expected);
}

describe.skipIf(!url)("database", { timeout: 60_000 }, () => {
  let connection: ReturnType<typeof createDb>;

  async function rowCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of Object.values(schema).filter((value) => is(value, PgTable))) {
      counts[getTableName(table)] = await connection.db.$count(table);
    }
    return counts;
  }

  let ticketNumber = 0;
  const newTicket = (plate: string, status: TicketStatus = "STARTED") =>
    connection.db
      .insert(schema.tickets)
      .values({ ticketNo: `TEST-${++ticketNumber}`, plate, status, language: "en" })
      .returning({ id: schema.tickets.id });

  beforeAll(async () => {
    await resetTestDatabase(url!);
    connection = createDb(url!, { max: 1 });
  }, 60_000);

  beforeEach(async () => {
    await seedDatabase(connection.db, { reset: true });
  }, 60_000);

  afterAll(() => connection?.close());

  describe("seed", () => {
    it("loads the default data", async () => {
      expect(await rowCounts()).toMatchObject({
        users: 12,
        materials: 9,
        chainages: 10,
        unloading_points: 7,
        unloading_rules: 8,
        transporters: 4,
        vehicles: 8,
        suppliers: 4,
        settings: 7,
        tickets: 0,
      });
    });

    it("can run again without duplicates, new ids or lost tickets", async () => {
      await newTicket("MH12AB1234");
      const before = await rowCounts();
      const users = await connection.db.select({ id: schema.users.id }).from(schema.users);

      await seedDatabase(connection.db);

      expect(await rowCounts()).toEqual(before);
      expect(await connection.db.select({ id: schema.users.id }).from(schema.users)).toEqual(users);
    });

    it("stores bcrypt hashes that match the demo PINs", async () => {
      const rows = await connection.db.select().from(schema.users);
      for (const { username, pin } of SEED_USERS) {
        const row = rows.find((user) => user.username === username);
        expect(row?.pinHash).not.toContain(pin);
        expect(await bcrypt.compare(pin, row!.pinHash)).toBe(true);
      }
    });

    it("keeps Hindi text intact", async () => {
      const [sand] = await connection.db
        .select()
        .from(schema.materials)
        .where(eq(schema.materials.name, "Sand"));
      expect(sand?.aliasesHi).toEqual(["रेत", "बालू"]);
    });

    it("clears tickets and their timeline on reset", async () => {
      const [ticket] = await newTicket("MH12AB1234");
      await connection.db
        .insert(schema.ticketEvents)
        .values({ ticketId: ticket!.id, type: "created", actor: "system" });

      await seedDatabase(connection.db, { reset: true });

      expect(await rowCounts()).toMatchObject({ tickets: 0, ticket_events: 0, users: 12 });
    });
  });

  describe("tickets", () => {
    const openStatuses = TICKET_STATUSES.filter(
      (status) => !(CLOSED_TICKET_STATUSES as readonly string[]).includes(status),
    );

    it.each(openStatuses)("allows no second ticket for a plate while one is %s", async (status) => {
      await newTicket("MH12AB1234", status);
      await expectRefused(newTicket("MH12AB1234"), "tickets_one_open_per_plate");
    });

    it.each(CLOSED_TICKET_STATUSES)("allows a new ticket after one is %s", async (status) => {
      await newTicket("MH12AB1234", status);
      await expect(newTicket("MH12AB1234")).resolves.toHaveLength(1);
    });

    it("keeps ticket numbers unique", async () => {
      const values = { ticketNo: "WB01-20261126-0001", language: "en" as const };
      await connection.db.insert(schema.tickets).values({ ...values, plate: "MH12AB1234" });
      await expectRefused(
        connection.db.insert(schema.tickets).values({ ...values, plate: "MH14CD5678" }),
        "tickets_ticket_no_unique",
      );
    });

    it.each(["MH 12 AB 1234", "MH-12-AB-1234", "mh12ab1234"])(
      "refuses the plate %s because it is not normalised",
      async (plate) => {
        await expectRefused(newTicket(plate), "tickets_plate_normalised");
      },
    );
  });

  describe("vehicles", () => {
    it("keeps plates unique", async () => {
      await expectRefused(
        connection.db.insert(schema.vehicles).values({ plate: "MH12AB1234", transporterId: 1 }),
        "vehicles_plate_unique",
      );
    });
  });

  describe("unloading rules", () => {
    async function addRule(materialName: string, tripFrom: number, tripTo: number) {
      const [material] = await connection.db
        .select()
        .from(schema.materials)
        .where(eq(schema.materials.name, materialName));
      return connection.db
        .insert(schema.unloadingRules)
        .values({ materialId: material!.id, tripFrom, tripTo, pointId: 1 });
    }

    // Sand already has trips 1 to 999.
    it.each([
      [999, 1200],
      [500, 600],
      [1, 1],
    ])("refuses an overlapping range %i to %i", async (from, to) => {
      await expectRefused(addRule("Sand", from, to), "unloading_rules_no_overlap");
    });

    it("allows the next range, and the same range for another material", async () => {
      await expect(addRule("Sand", 1000, 1200)).resolves.toBeDefined();
      await expect(addRule("Bricks", 1, 999)).resolves.toBeDefined();
    });

    it("refuses a backwards range", async () => {
      await expectRefused(addRule("Bricks", 5, 4), "unloading_rules_shape");
    });

    it("allows only one overall default", async () => {
      await expectRefused(
        connection.db.insert(schema.unloadingRules).values({ pointId: 1, isDefault: true }),
        "unloading_rules_one_default",
      );
    });
  });

  describe("ticket_events", () => {
    async function addEvent() {
      const [ticket] = await newTicket("MH12AB1234");
      await connection.db
        .insert(schema.ticketEvents)
        .values({ ticketId: ticket!.id, type: "created", actor: "device:esp32" });
    }

    it("refuses UPDATE", async () => {
      await addEvent();
      // 23001 is restrict_violation, raised by the trigger.
      await expectRefused(
        connection.db.update(schema.ticketEvents).set({ type: "changed" }),
        "23001",
      );
    });

    it("refuses DELETE", async () => {
      await addEvent();
      await expectRefused(connection.db.delete(schema.ticketEvents), "23001");
      expect(await connection.db.$count(schema.ticketEvents)).toBe(1);
    });
  });

  describe("approvals", () => {
    it.each(["BLOCKED_HISTORY", "FRONT_BACK_MISMATCH"] as const)(
      "stores a plate warning with the reason %s",
      async (plateWarningReason) => {
        const [ticket] = await newTicket("MH12AB1234");
        await expect(
          connection.db
            .insert(schema.approvals)
            .values({ ticketId: ticket!.id, kind: "PLATE_WARNING", plateWarningReason }),
        ).resolves.toBeDefined();
      },
    );

    it("refuses a plate warning without a reason, and a reason on anything else", async () => {
      const [ticket] = await newTicket("MH12AB1234");
      const ticketId = ticket!.id;
      await expectRefused(
        connection.db.insert(schema.approvals).values({ ticketId, kind: "PLATE_WARNING" }),
        "approvals_plate_warning_reason",
      );
      await expectRefused(
        connection.db
          .insert(schema.approvals)
          .values({ ticketId, kind: "HOLD", plateWarningReason: "BLOCKED_HISTORY" }),
        "approvals_plate_warning_reason",
      );
    });

    it("needs a ticket, except for driver help", async () => {
      await expect(
        connection.db.insert(schema.approvals).values({ kind: "DRIVER_HELP" }),
      ).resolves.toBeDefined();
      await expectRefused(
        connection.db.insert(schema.approvals).values({ kind: "HOLD" }),
        "approvals_ticket_required",
      );
    });
  });
});
