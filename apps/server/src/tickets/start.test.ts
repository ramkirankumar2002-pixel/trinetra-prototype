import { ticketNumber, type CreateTicketResponse, type TicketView } from "@trinetra/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { photos, tickets } from "../db/schema";
import { testDatabaseUrl } from "../test/env";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("starting a ticket", { timeout: 30_000 }, () => {
  const h = useTicketHarness();

  const start = (body: Record<string, unknown> = {}) =>
    h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate: PLATE,
      language: "en",
      manual: true,
      ...body,
    });

  async function readPlates(front: string | null = PLATE, back = front, times = 1) {
    h.cameras(front, back);
    h.weigh(32_560);
    let body!: { photoIds: string[] };
    for (let i = 0; i < times; i++) {
      body = (await h.call<{ photoIds: string[] }>("kiosk", "POST", "/api/anpr")).body;
    }
    return body.photoIds;
  }

  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  it("is for the logged-in kiosk only", async () => {
    await h.expectRoles("POST", "/api/tickets", ["kiosk"], { plate: PLATE, language: "en" });
  });

  it.each([
    ["no plate", { plate: undefined }],
    ["half a plate", { plate: "MH12" }],
    ["an unknown language", { language: "te" }],
    ["a weight", { firstWeightKg: 100 }],
    ["a photo id that is not an id", { photoIds: ["x"] }],
  ])("refuses %s", async (_what, body) => {
    const response = await start(body);
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("starts a ticket from the confirmed camera plate and keeps the photos", async () => {
    const photoIds = await readPlates();
    const { status, body } = await start({ manual: false, photoIds, plate: "mh 12 ab-1234" });

    expect(status).toBe(201);
    expect(body.resumed).toBe(false);
    expect(body.ticket).toMatchObject({
      ticketNo: ticketNumber(new Date(), 1),
      plate: PLATE,
      status: "STARTED",
      language: "en",
      // From the vehicle list.
      transporter: "Sri Balaji Transport",
      isDemo: false,
      plateCheck: "NOT_NEEDED",
    });
    expect(body.ticket.photos.map((photo) => photo.id).sort()).toEqual([...photoIds].sort());
    expect(body.ticket.timeline[0]).toMatchObject({
      type: "TICKET_CREATED",
      actorName: "WB-01",
      data: { manual: false },
    });
  });

  it("marks a typed plate as manual on the timeline", async () => {
    const { body } = await start();
    expect(body.ticket.timeline[0]?.data).toMatchObject({ manual: true, anpr: null });
  });

  it("refuses a plate that was neither read nor typed", async () => {
    expect((await start({ manual: false })).body.error?.code).toBe("PLATE_NOT_READ");
    await readPlates(PLATE);
    const response = await start({ manual: false, plate: OTHER_PLATE });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("PLATE_NOT_CONFIRMED");
  });

  it("refuses photos that are not of this truck", async () => {
    const response = await start({ photoIds: ["3f2504e0-4f89-41d3-9a0c-0305e82c3301"] });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("UNKNOWN_PHOTO_ID");
  });

  describe("front and back plates that differ", () => {
    it("cannot be confirmed before the retries are used up", async () => {
      await readPlates(PLATE, OTHER_PLATE, 2);
      expect((await start({ manual: false })).body.error?.code).toBe("PLATE_NOT_CONFIRMED");
    });

    it("on the third read takes the driver's plate and warns the store officer only", async () => {
      await readPlates(PLATE, OTHER_PLATE, 3);
      const { status, body } = await start({ manual: false });

      expect(status).toBe(201);
      expect(body.ticket.approvals).toMatchObject([
        { kind: "PLATE_WARNING", plateWarningReason: "FRONT_BACK_MISMATCH", status: "PENDING" },
      ]);
      // A warning never blocks.
      expect(body.ticket.plateCheck).toBe("NOT_NEEDED");
      expect(
        await h.db.select().from(photos).where(eq(photos.ticketId, body.ticket.id)),
      ).toHaveLength(6);
    });

    it("also warns when the driver types the plate instead", async () => {
      await readPlates(PLATE, OTHER_PLATE);
      const { body } = await start({ manual: true });
      expect(body.ticket.approvals).toMatchObject([{ plateWarningReason: "FRONT_BACK_MISMATCH" }]);
    });

    it("on a second visit puts the warning on the open ticket", async () => {
      const { body } = await start();
      await h.db.update(tickets).set({ status: "READY_FOR_SECOND" });
      await readPlates(PLATE, OTHER_PLATE, 4);
      const warnings = await h.approvalRows();
      // Once, however often the plate is read.
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        ticketId: body.ticket.id,
        plateWarningReason: "FRONT_BACK_MISMATCH",
      });
      expect(await h.eventTypes(body.ticket.id)).toContain("PLATE_READ");
    });
  });

  describe("resuming", () => {
    it("continues a STARTED ticket younger than 10 minutes", async () => {
      const first = await start();
      await h.db.update(tickets).set({ updatedAt: minutesAgo(9) });
      const again = await start({ language: "hi" });

      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({
        resumed: true,
        ticket: { id: first.body.ticket.id, language: "hi" },
      });
      expect(await h.allTickets()).toHaveLength(1);
      expect(await h.eventTypes(first.body.ticket.id)).toContain("TICKET_RESUMED");
    });

    it("abandons an older one and starts again", async () => {
      const first = await start();
      await h.db.update(tickets).set({ updatedAt: minutesAgo(10) });
      const again = await start();

      expect(again.body.resumed).toBe(false);
      expect(again.body.ticket.ticketNo).toBe(ticketNumber(new Date(), 2));
      expect((await h.ticketRow(first.body.ticket.id)).status).toBe("ABANDONED");
    });

    it("refuses while the truck has an open ticket at a later step", async () => {
      await start();
      await h.db.update(tickets).set({ status: "SUPERVISOR_PENDING" });
      const response = await start();
      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        code: "OPEN_TICKET",
        details: { status: "SUPERVISOR_PENDING" },
      });
    });

    it("gives one ticket for two requests at the same moment", async () => {
      const answers = await Promise.all([start(), start()]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 201]);
      expect(await h.allTickets()).toHaveLength(1);
    });
  });

  it("numbers tickets in order, even when two start at once", async () => {
    const plates = ["MH12AB1234", "MH14CD5678", "UP32EF9012", "UP70GH3456", "MP09JK7890"];
    const answers = await Promise.all(plates.map((plate) => start({ plate })));
    expect(answers.map((answer) => answer.body.ticket.ticketNo).sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => ticketNumber(new Date(), n)),
    );
  });

  describe("a plate that was blocked or rejected", () => {
    async function earlier(status: "BLOCKED" | "REJECTED" | "ABANDONED", closedAt: Date) {
      await start();
      await h.db.update(tickets).set({ status, closedAt });
    }

    it.each(["BLOCKED", "REJECTED"] as const)(
      "needs the store officer when it was %s in the last 24 hours",
      async (status) => {
        await earlier(status, minutesAgo(23 * 60 + 59));
        const { body } = await start();
        expect(body.ticket.plateCheck).toBe("PENDING");
        expect(body.ticket.approvals).toMatchObject([
          { kind: "PLATE_WARNING", plateWarningReason: "BLOCKED_HISTORY", status: "PENDING" },
        ]);
      },
    );

    it("is free again after 24 hours", async () => {
      await earlier("BLOCKED", minutesAgo(24 * 60 + 1));
      expect((await start()).body.ticket.plateCheck).toBe("NOT_NEEDED");
    });

    it("is not blocked by an abandoned ticket", async () => {
      await earlier("ABANDONED", minutesAgo(5));
      expect((await start()).body.ticket.plateCheck).toBe("NOT_NEEDED");
    });
  });

  describe("GET /api/tickets/:id", () => {
    it("returns the ticket and its timeline to the kiosk and the store", async () => {
      const { body } = await start();
      for (const who of ["kiosk", "store"] as const) {
        const response = await h.call<TicketView>(who, "GET", `/api/tickets/${body.ticket.id}`);
        expect(response.status).toBe(200);
        expect(response.body.timeline.length).toBeGreaterThan(0);
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    });

    it("shows a supervisor only their own Type 1 trucks", async () => {
      const { body } = await start();
      const url = `/api/tickets/${body.ticket.id}`;
      expect((await h.call("amit", "GET", url)).body.error?.code).toBe("NOT_YOUR_TICKET");

      await h.db.update(tickets).set({ type: "TYPE_1", supervisorId: h.userId("amit") });
      expect((await h.call("amit", "GET", url)).status).toBe(200);
      expect((await h.call("suresh", "GET", url)).status).toBe(403);
    });

    it("answers 401, 404 and 400", async () => {
      expect((await h.call(null, "GET", "/api/tickets/1")).status).toBe(401);
      expect((await h.call("kiosk", "GET", "/api/tickets/999")).status).toBe(404);
      expect((await h.call("kiosk", "GET", "/api/tickets/abc")).status).toBe(400);
    });
  });
});
