import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows, LOADED } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { waitFor } from "../test/device-client";
import { scheduleAbandonedSweep, sweepAbandoned } from "./abandon";

describe.skipIf(!testDatabaseUrl)("abandoned tickets", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, started, weighed, secondWeight, pending } = flows(h);

  const idleFor = (id: number, interval: string) =>
    h.db.execute(`update tickets set updated_at = now() - interval '${interval}' where id = ${id}`);

  it("abandons STARTED tickets idle for 10 minutes, with a timeline row", async () => {
    const stale = await started();
    const fresh = await started({ plate: OTHER_PLATE });
    await idleFor(stale, "10 minutes 1 second");
    await idleFor(fresh, "9 minutes 50 seconds");

    expect(await sweepAbandoned(h.app)).toBe(1);
    expect((await h.ticketRow(fresh)).status).toBe("STARTED");
    const ticket = await view(stale);
    expect(ticket.status).toBe("ABANDONED");
    expect(ticket.closedAt).not.toBeNull();
    expect(ticket.timeline.at(-1)).toMatchObject({ type: "ABANDON", actorName: "System" });
    expect(await sweepAbandoned(h.app)).toBe(0);
  });

  describe("while it waits for a person", () => {
    const status = async (id: number) => (await h.ticketRow(id)).status;
    const help = async (ticketId: number) =>
      (await h.call<{ approvalId: number }>("kiosk", "POST", "/api/help", { ticketId })).body
        .approvalId;
    const decide = (id: number, body: unknown) =>
      h.call("store", "POST", `/api/approvals/${id}/decide`, body);

    async function helpCalled() {
      const id = await started();
      await help(id);
      return id;
    }
    /** A plate rejected a moment ago is back: the new visit waits for the store officer. */
    async function blockedPlate() {
      const first = await weighed({ material: "Sand", invoiceKg: 14_310 });
      await decide(await pending(first, "STORE_TYPE2"), { decision: "REJECT", reason: "Load" });
      return started();
    }
    async function mismatched() {
      const id = await started({ material: "Cement Bags" });
      await h.db.execute(`update tickets set invoice_material = 'Cement Bags' where id = ${id}`);
      for (let n = 0; n < 5; n++) {
        await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Sand" });
      }
      return id;
    }
    async function onHold() {
      const id = await weighed({ invoiceKg: 14_500 });
      await secondWeight(id);
      return id;
    }

    it.each([
      ["driver help", "STARTED", helpCalled],
      ["a blocked plate", "STARTED", blockedPlate],
      ["a mismatch", "MISMATCH_PENDING", mismatched],
      [
        "a Type 2 decision",
        "STORE_PENDING",
        () => weighed({ material: "Sand", invoiceKg: 14_500 }),
      ],
      ["a supervisor's check", "SUPERVISOR_PENDING", () => weighed({ material: "Cement Bags" })],
      ["a HOLD", "HOLD_PENDING", onHold],
    ] as const)("is never abandoned while %s is open, however long", async (_what, at, make) => {
      const id = await make();
      expect(await status(id)).toBe(at);
      await idleFor(id, "2 days");
      expect(await sweepAbandoned(h.app)).toBe(0);
      expect(await status(id)).toBe(at);
    });

    it("is carried on, not replaced, when the truck comes back much later", async () => {
      const id = await helpCalled();
      await idleFor(id, "3 hours");
      const again = await h.call<{ resumed: boolean; ticket: { id: number } }>(
        "kiosk",
        "POST",
        "/api/tickets",
        { plate: PLATE, language: "en", manual: true },
      );
      expect(again.body).toMatchObject({ resumed: true, ticket: { id } });
    });

    it("gives the driver a new 10 minutes once the help call is answered", async () => {
      const id = await started();
      const call = await help(id);
      await idleFor(id, "1 hour");
      await decide(call, { decision: "APPROVE" });

      expect(await sweepAbandoned(h.app)).toBe(0);
      await idleFor(id, "10 minutes 1 second");
      expect(await sweepAbandoned(h.app)).toBe(1);
    });

    it("also after a blocked plate is allowed", async () => {
      const id = await blockedPlate();
      await idleFor(id, "1 hour");
      await decide(await pending(id, "PLATE_WARNING"), { decision: "APPROVE", reason: "Seen" });
      expect(await sweepAbandoned(h.app)).toBe(0);
      await idleFor(id, "11 minutes");
      expect(await sweepAbandoned(h.app)).toBe(1);
    });
  });

  describe("while it waits for the driver, with a front/back warning open", () => {
    async function warned() {
      h.cameras(PLATE, OTHER_PLATE);
      h.weigh(LOADED);
      await h.call("kiosk", "POST", "/api/anpr");
      return started();
    }

    it("is still abandoned after 10 minutes: the warning holds nobody up", async () => {
      const id = await warned();
      await pending(id, "PLATE_WARNING");
      await idleFor(id, "11 minutes");
      expect(await sweepAbandoned(h.app)).toBe(1);
    });

    it("is not kept longer because the warning was marked as seen", async () => {
      const id = await warned();
      const warning = await pending(id, "PLATE_WARNING");
      await idleFor(id, "11 minutes");
      await h.call("store", "POST", `/api/approvals/${warning}/decide`, { decision: "APPROVE" });
      expect(await sweepAbandoned(h.app)).toBe(1);
    });
  });

  it("never abandons a ticket that has its first weight, or waits for the store", async () => {
    const saved = await weighed();
    const held = await weighed({ plate: OTHER_PLATE, material: "Sand", invoiceKg: 14_500 });
    await idleFor(saved, "2 days");
    await idleFor(held, "2 days");
    expect(await sweepAbandoned(h.app)).toBe(0);
  });

  it("frees the plate for a new ticket", async () => {
    const stale = await started();
    await idleFor(stale, "1 hour");
    await sweepAbandoned(h.app);
    expect(await started()).not.toBe(stale);
  });

  it("runs on a timer", async () => {
    const stale = await started();
    await idleFor(stale, "1 hour");
    // A second app, so a short interval can be set before it is ready.
    await h.restart((app) => scheduleAbandonedSweep(app, 50));
    await waitFor(() => false, 400).catch(() => undefined);
    expect((await h.ticketRow(stale)).status).toBe("ABANDONED");
  });

  describe("a backend restart with a truck on the bridge", () => {
    const counts = async () => [(await h.allTickets()).length, (await h.approvalRows()).length];

    it("creates nothing when truck:arrived fires again", async () => {
      const id = await started({ plate: PLATE });
      h.weigh(LOADED);
      await h.restart();

      let arrivals = 0;
      h.app.hardware.bus.on("truck:arrived", () => arrivals++);
      h.weigh(LOADED);
      await waitFor(() => arrivals === 1);
      h.app.hardware.bus.emit("truck:arrived", { kg: LOADED });

      expect(await counts()).toEqual([1, 0]);
      // And the driver continues with the ticket they had.
      const again = await h.call<{ resumed: boolean; ticket: { id: number } }>(
        "kiosk",
        "POST",
        "/api/tickets",
        { plate: PLATE, language: "en", manual: true },
      );
      expect(again.body).toMatchObject({ resumed: true, ticket: { id } });
      expect(await counts()).toEqual([1, 0]);
    });
  });
});
