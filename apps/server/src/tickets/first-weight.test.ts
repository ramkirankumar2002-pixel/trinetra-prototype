import { describe, expect, it } from "vitest";
import { tickets } from "../db/schema";
import { testDatabaseUrl } from "../test/env";
import { flows, LOADED } from "../test/flows";
import { OTHER_PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("first weight", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, started, weighed } = flows(h);

  it("is for the logged-in kiosk only", async () => {
    await h.expectRoles("POST", "/api/tickets/1/first-weight", ["kiosk"]);
  });

  it("never takes a weight from the request", async () => {
    const id = await started();
    await h.settle(LOADED);
    const response = await post(id, "first-weight", { kg: 99_999 });
    expect(response.status).toBe(400);
    expect((await h.ticketRow(id)).firstWeightKg).toBeNull();
  });

  it("refuses with the reason while the weight cannot be captured", async () => {
    const id = await started();
    const refused = async () => {
      const response = await post(id, "first-weight");
      expect(response.status).toBe(409);
      return response.body.error?.code;
    };
    expect(await refused()).toBe("DEVICE_OFFLINE");
    h.leave();
    expect(await refused()).toBe("NO_TRUCK");
    h.weigh(LOADED, { pos: false });
    expect(await refused()).toBe("POSITION_NOT_OK");
    h.weigh(LOADED, { stable: false });
    expect(await refused()).toBe("NOT_STABLE");
    expect((await h.ticketRow(id)).status).toBe("STARTED");
  });

  it("answers 404, 400 and 409", async () => {
    expect((await post(999, "first-weight")).status).toBe(404);
    expect((await h.call("kiosk", "POST", "/api/tickets/0/first-weight")).status).toBe(400);
    const id = await weighed();
    const again = await post(id, "first-weight");
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("WRONG_STAGE");
  });

  it("needs a material", async () => {
    const id = await started();
    await h.db.update(tickets).set({ materialId: null });
    await h.settle(LOADED);
    expect((await post(id, "first-weight")).body.error?.code).toBe("DETAILS_REQUIRED");
  });

  it("needs the invoice weight where the type depends on it", async () => {
    const id = await started({ material: "Sand", invoiceKg: null });
    await h.settle(LOADED);
    const response = await post(id, "first-weight");
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("INVOICE_WEIGHT_REQUIRED");
  });

  it("saves a Type 3 weight and goes straight to ready for the second", async () => {
    const id = await weighed({ material: "Sand", invoiceKg: 1000 });
    expect(await view(id)).toMatchObject({
      type: "TYPE_3",
      status: "READY_FOR_SECOND",
      firstWeightKg: LOADED,
      heldWeightKg: null,
      tripNo: 1,
      unloadingPoint: { code: "CH-012+300" },
      supervisor: { name: "Pankaj Gupta" },
      approvals: [],
      isDemo: false,
    });
    expect((await h.eventTypes(id)).slice(-2)).toEqual([
      "FIRST_WEIGHT_SAVED",
      "SECOND_WEIGHT_ALLOWED",
    ]);
    const saved = (await view(id)).timeline.find((e) => e.type === "FIRST_WEIGHT_SAVED");
    expect(saved).toMatchObject({ actorName: "WB-01", data: { kg: LOADED, source: "esp32" } });
  });

  it("sends a Type 1 truck to its supervisor", async () => {
    const id = await weighed({ material: "Cement Bags" });
    expect(await view(id)).toMatchObject({
      type: "TYPE_1",
      status: "SUPERVISOR_PENDING",
      firstWeightKg: LOADED,
      unloadingPoint: { code: "Plant" },
      supervisor: { id: h.userId("amit") },
      approvals: [{ kind: "SUPERVISOR", status: "PENDING" }],
    });
  });

  it("writes one timeline row for the supervisor request", async () => {
    const id = await weighed({ material: "Cement Bags" });
    const { timeline, approvals } = await view(id);
    expect(timeline.slice(-2).map((entry) => entry.type)).toEqual([
      "FIRST_WEIGHT_SAVED",
      "SUPERVISOR_REQUESTED",
    ]);
    expect(timeline.at(-1)!.data).toMatchObject({
      approvalId: approvals[0]!.id,
      kind: "SUPERVISOR",
    });
    expect(timeline.map((entry) => entry.type)).not.toContain("APPROVAL_REQUESTED");
  });

  it("weighs a Type 1 truck without an invoice weight", async () => {
    const id = await weighed({ material: "Cement Bags", invoiceKg: null });
    expect((await h.ticketRow(id)).status).toBe("SUPERVISOR_PENDING");
  });

  it("holds a Type 2 weight for the store officer", async () => {
    const id = await weighed({ material: "Sand", invoiceKg: 1001 });
    expect(await view(id)).toMatchObject({
      type: "TYPE_2",
      status: "STORE_PENDING",
      heldWeightKg: LOADED,
      firstWeightKg: null,
      tripNo: null,
      unloadingPoint: null,
      approvals: [{ kind: "STORE_TYPE2", status: "PENDING" }],
    });
  });

  it("blocks a plate that waits for the store officer", async () => {
    await started();
    await h.db.update(tickets).set({ status: "BLOCKED", closedAt: new Date() });
    const id = await started();
    await h.settle(LOADED);
    const response = await post(id, "first-weight");
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual({
      code: "NOT_APPROVED_EARLIER",
      message: "Not approved earlier. Please go to the store office.",
    });
    expect((await h.ticketRow(id)).heldWeightKg).toBeNull();
  });

  describe("trip numbers", () => {
    const plates = ["MH12AB1234", "MH14CD5678", "UP32EF9012", "UP70GH3456", "MP09JK7890"];

    it("counts per material and moves to the next unloading point", async () => {
      const trips: [number | null, string | undefined][] = [];
      for (const plate of plates) {
        const ticket = await view(
          await weighed({ plate, material: "Aggregate 10 mm", invoiceKg: 500 }),
        );
        trips.push([ticket.tripNo, ticket.unloadingPoint?.code]);
      }
      expect(trips.map(([trip]) => trip)).toEqual([1, 2, 3, 4, 5]);
      expect(trips[2]![1]).toBe("CH-005+250");
      expect(trips[3]![1]).toBe("CH-009+800");
      // Another material starts at 1.
      const sand = await view(
        await weighed({ plate: "DL01NP6789", material: "Sand", invoiceKg: 900 }),
      );
      expect(sand.tripNo).toBe(1);
    });

    it("gives two trucks weighed at the same moment different numbers", async () => {
      for (let round = 0; round < 3; round++) {
        await h.db.execute(
          "truncate approvals, ticket_events, upload_links, photos, tickets cascade",
        );
        const first = await started({ plate: "MH12AB1234" });
        const second = await started({ plate: OTHER_PLATE });
        await h.settle(LOADED);
        const answers = await Promise.all([
          post(first, "first-weight"),
          post(second, "first-weight"),
        ]);
        expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
        expect(answers.map((answer) => answer.body.tripNo).sort()).toEqual([1, 2]);
      }
    });

    it("saves one weight when one truck asks twice at once", async () => {
      const id = await started();
      await h.settle(LOADED);
      const answers = await Promise.all([post(id, "first-weight"), post(id, "first-weight")]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      expect((await h.eventTypes(id)).filter((type) => type === "FIRST_WEIGHT_SAVED")).toHaveLength(
        1,
      );
    });
  });
});
