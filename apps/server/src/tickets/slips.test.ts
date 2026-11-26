import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows, LOADED } from "../test/flows";
import { useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("discard weight and slips", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, started, weighed, secondWeight } = flows(h);

  it("are for the logged-in kiosk only", async () => {
    await h.expectRoles("POST", "/api/tickets/1/discard-weight", ["kiosk"]);
    await h.expectRoles("POST", "/api/tickets/1/printed", ["kiosk"], { kind: "FIRST" });
  });

  describe("POST /api/tickets/:id/discard-weight", () => {
    it("logs it and starts the stability window again", async () => {
      const id = await started();
      await h.settle(LOADED);
      const response = await post(id, "discard-weight");

      expect(response.status).toBe(200);
      expect(response.body.status).toBe("STARTED");
      expect(response.body.timeline.at(-1)).toMatchObject({
        type: "WEIGHT_DISCARDED",
        data: { weighing: "FIRST", kg: LOADED },
      });
      // Not at once: the weight must hold still for the whole window again.
      expect((await post(id, "first-weight")).body.error?.code).toBe("NOT_STABLE");
      await h.settle(LOADED);
      expect((await post(id, "first-weight")).status).toBe(200);
    });

    it("works before the second weight, and never once a weight is saved", async () => {
      const id = await weighed();
      expect((await post(id, "discard-weight")).body.timeline.at(-1)?.data).toMatchObject({
        weighing: "SECOND",
      });
      await secondWeight(id, 17_000);
      for (const attempt of [1, 2]) {
        const response = await post(id, "discard-weight");
        expect(response.status, `try ${attempt}`).toBe(409);
      }
      expect(await view(id)).toMatchObject({ status: "HOLD_PENDING", secondWeightKg: 17_000 });
    });

    it("cannot remove a first weight that is waiting for a person", async () => {
      const id = await weighed({ material: "Cement Bags" });
      expect((await post(id, "discard-weight")).status).toBe(409);
      expect((await h.ticketRow(id)).firstWeightKg).toBe(LOADED);
    });

    it("answers 404 and 400", async () => {
      expect((await post(999, "discard-weight")).status).toBe(404);
      expect((await post(1, "discard-weight", { kg: 1 })).status).toBe(400);
    });
  });

  describe("POST /api/tickets/:id/printed", () => {
    it("logs each print of the slips the ticket has", async () => {
      const id = await weighed();
      expect((await post(id, "printed", { kind: "FIRST" })).status).toBe(200);
      expect((await post(id, "printed", { kind: "REPRINT" })).status).toBe(200);
      expect((await post(id, "printed", { kind: "FINAL" })).status).toBe(409);
      await secondWeight(id);
      expect((await post(id, "printed", { kind: "FINAL" })).status).toBe(200);

      const printed = (await view(id)).timeline.filter((e) => e.type === "SLIP_PRINTED");
      expect(printed.map((e) => e.data.kind)).toEqual(["FIRST", "REPRINT", "FINAL"]);
    });

    it("has no slip before the first weight", async () => {
      const id = await started();
      for (const kind of ["FIRST", "FINAL", "REPRINT"]) {
        expect((await post(id, "printed", { kind })).status).toBe(409);
      }
    });

    it("answers 404 and 400", async () => {
      expect((await post(999, "printed", { kind: "FIRST" })).status).toBe(404);
      expect((await post(1, "printed", { kind: "OTHER" })).status).toBe(400);
      expect((await post(1, "printed")).status).toBe(400);
    });
  });
});
