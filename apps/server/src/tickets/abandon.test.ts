import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows, LOADED } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { waitFor } from "../test/device-client";
import { scheduleAbandonedSweep, sweepAbandoned } from "./abandon";

describe.skipIf(!testDatabaseUrl)("abandoned tickets", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, started, weighed } = flows(h);

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
