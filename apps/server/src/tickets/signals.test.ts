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

    /** The lights (entry then exit) and the middle line of the display, as last told. */
    function watch() {
      const lights = vi.spyOn(h.app.hardware.commands, "setLights");
      const lines = vi.spyOn(h.app.hardware.commands, "showLines");
      return () => {
        const light = lights.mock.lastCall?.[0];
        return [light && `${light.entry}${light.exit}`, lines.mock.lastCall?.[0][1]];
      };
    }

    it("is red while the ticket is filled in, then says where to unload", async () => {
      const shown = watch();
      const beeps = vi.spyOn(h.app.hardware.commands, "buzz");
      const id = await started({ material: "Cement Bags", invoiceKg: 400 });
      expect(shown()).toEqual(["RR", "WAIT"]);
      await h.settle(LOADED);
      await post(id, "first-weight");
      expect(shown()).toEqual(["RG", "Plant"]);
      // Two short beeps: the weight has been taken.
      expect(beeps).toHaveBeenLastCalledWith(120, 2);
      await secondWeight(id, LOADED - 400);
      expect(shown()).toEqual(["RG", "THANK YOU"]);
    });

    it("asks a Type 2 truck to move aside", async () => {
      const shown = watch();
      await weighed({ material: "Cement Bags", invoiceKg: 14_500 });
      expect(shown()).toEqual(["RG", "WAIT"]);
    });

    it("sends a truck on hold to the store office", async () => {
      const shown = watch();
      const id = await weighed({ invoiceKg: 14_500 });
      await secondWeight(id);
      expect(shown()).toEqual(["RG", "OFFICE"]);
    });

    it("sends a mismatch and a blocked plate to the store office", async () => {
      const shown = watch();
      const id = await started({ plate: OTHER_PLATE });
      await h.db.execute(`update tickets set invoice_material = 'Cement Bags' where id = ${id}`);
      for (let n = 0; n < 5; n++) {
        await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Bricks" });
      }
      // The truck stays on the bridge: both ends stay red.
      expect(shown()).toEqual(["RR", "OFFICE"]);

      await h.db.execute(`update tickets set status = 'BLOCKED', closed_at = now()`);
      await started({ plate: OTHER_PLATE });
      // The details were saved after the ticket started, which changes no light.
      expect(shown()).toEqual(["RR", "OFFICE"]);
    });
  },
);
