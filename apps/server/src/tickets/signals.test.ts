// The lights and display at each key moment of a ticket.
import { describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows, LOADED } from "../test/flows";
import { OTHER_PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)(
  "hardware signals in the ticket flow",
  { timeout: 30_000 },
  () => {
    const h = useTicketHarness();
    const { post, started, weighed, secondWeight } = flows(h);

    /** What the display was last told, and the light. */
    function watch() {
      const light = vi.spyOn(h.app.hardware.commands, "setLight");
      const text = vi.spyOn(h.app.hardware.commands, "showText");
      return () => [light.mock.lastCall?.[0], text.mock.lastCall?.[0]];
    }

    it("is red while the ticket is filled in, then says where to unload", async () => {
      const shown = watch();
      const id = await started({ material: "Aggregate 10 mm", invoiceKg: 400 });
      expect(shown()).toEqual(["red", "Please wait"]);
      await h.settle(LOADED);
      await post(id, "first-weight");
      expect(shown()).toEqual(["orange", "Go to CH-005+250"]);
      await secondWeight(id, LOADED - 400);
      expect(shown()).toEqual(["orange", "Thank you"]);
    });

    it("asks a Type 2 truck to wait", async () => {
      const shown = watch();
      await weighed({ material: "Sand", invoiceKg: 14_500 });
      expect(shown()).toEqual(["orange", "Please wait"]);
    });

    it("sends a truck on hold to the store office", async () => {
      const shown = watch();
      const id = await weighed({ invoiceKg: 14_500 });
      await secondWeight(id);
      expect(shown()).toEqual(["orange", "Go to store office"]);
    });

    it("sends a mismatch and a blocked plate to the store office", async () => {
      const shown = watch();
      const id = await started({ plate: OTHER_PLATE });
      await h.db.execute(`update tickets set invoice_material = 'Sand' where id = ${id}`);
      for (let n = 0; n < 5; n++) {
        await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Bricks" });
      }
      expect(shown()).toEqual(["orange", "Go to store office"]);

      await h.db.execute(`update tickets set status = 'BLOCKED', closed_at = now()`);
      await started({ plate: OTHER_PLATE });
      // The details were saved after the ticket started, which changes no light.
      expect(shown()).toEqual(["orange", "Go to store office"]);
    });
  },
);
