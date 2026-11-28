import type { ApprovalView, SupervisorTicketView, TicketView } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness, type Who } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("deciding requests", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, started, weighed, secondWeight, pending } = flows(h);

  const decide = (who: Who | null, approvalId: number, body: Record<string, unknown>) =>
    h.call<{ approval: ApprovalView; ticket: TicketView | null }>(
      who,
      "POST",
      `/api/approvals/${approvalId}/decide`,
      body,
    );
  const approve = { decision: "APPROVE" };
  const reject = { decision: "REJECT", reason: "Wrong vehicle" };

  async function type1(plate = PLATE) {
    const id = await weighed({ plate, material: "Sand" });
    return { id, request: await pending(id, "SUPERVISOR") };
  }
  async function type2(plate = PLATE) {
    const id = await weighed({ plate, material: "Cement Bags", invoiceKg: 14_310 });
    return { id, request: await pending(id, "STORE_TYPE2") };
  }
  async function onHold(invoiceKg: number | "unreadable" = 14_500, second = EMPTY) {
    const id = await weighed({ invoiceKg });
    await secondWeight(id, second);
    return { id, request: await pending(id, "HOLD") };
  }
  async function mismatched() {
    const id = await started({ material: "Sand" });
    await h.db.execute(`update tickets set invoice_material = 'Sand' where id = ${id}`);
    for (let n = 0; n < 5; n++) {
      await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Cement Bags" });
    }
    return { id, request: await pending(id, "MISMATCH") };
  }
  async function blockedPlate() {
    const { id, request } = await type1();
    await decide("pankaj", request, reject);
    const next = await started();
    return { old: id, id: next, request: await pending(next, "PLATE_WARNING") };
  }
  async function photoOf(id: number, seen: string | null) {
    h.supervisorSees(seen);
    const body = h.form({ data: await h.jpeg(), type: "image/jpeg" });
    await h.call(
      "pankaj",
      "POST",
      `/api/supervisor/tickets/${id}/photo`,
      body.payload,
      body.headers,
    );
  }

  describe("who may decide", () => {
    it("needs a login, and never the kiosk", async () => {
      expect((await decide(null, 1, approve)).status).toBe(401);
      expect((await decide("kiosk", 1, approve)).status).toBe(403);
    });

    it("leaves a truck check to its own supervisor", async () => {
      const { request } = await type1();
      expect((await decide("store", request, reject)).status).toBe(403);
      expect((await decide("suresh", request, reject)).body.error?.code).toBe("NOT_YOUR_REQUEST");
      expect((await decide("pankaj", request, reject)).status).toBe(200);
    });

    it("leaves every other request to the store officer", async () => {
      const { request } = await type2();
      expect((await decide("pankaj", request, approve)).status).toBe(403);
    });
  });

  it.each([
    ["no decision", {}],
    ["an unknown decision", { decision: "MAYBE" }],
    ["a rejection without a reason", { decision: "REJECT" }],
    ["a typed weight", { decision: "APPROVE", chosenWeight: 14_000 }],
    ["a new weight", { decision: "APPROVE", firstWeightKg: 1 }],
  ])("refuses %s", async (_what, body) => {
    const { request } = await type2();
    expect((await decide("store", request, body)).status).toBe(400);
  });

  it("answers 404 for no such request", async () => {
    expect((await decide("store", 999, approve)).status).toBe(404);
    expect((await h.call("store", "POST", "/api/approvals/x/decide", approve)).status).toBe(400);
  });

  it("never lets a decision be changed", async () => {
    const { id, request } = await type2();
    expect((await decide("store", request, approve)).status).toBe(200);
    const again = await decide("store", request, reject);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("ALREADY_DECIDED");
    expect((await view(id)).status).toBe("READY_FOR_SECOND");
  });

  it("takes one of two decisions made at the same moment", async () => {
    const { request } = await type2();
    const answers = await Promise.all([
      decide("store", request, approve),
      decide("store", request, reject),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
  });

  describe("supervisor", () => {
    it("approves after a matching photo", async () => {
      const { id, request } = await type1();
      await photoOf(id, PLATE);
      const { status, body } = await decide("pankaj", request, approve);

      expect(status).toBe(200);
      expect(body.approval).toMatchObject({ status: "APPROVED", decidedBy: "Pankaj Gupta" });
      expect(body.ticket?.status).toBe("READY_FOR_SECOND");
      expect((await secondWeight(id)).body.status).toBe("COMPLETED");
      const done = await h.call<{ tickets: SupervisorTicketView[] }>(
        "pankaj",
        "GET",
        "/api/supervisor/tickets?status=done",
      );
      expect(done.body.tickets).toMatchObject([{ ticketId: id, approvalStatus: "APPROVED" }]);
    });

    /** One character from PLATE (MH12AB1234). */
    const CLOSE_PLATE = "MH12AB1235";
    const override = { ...approve, manualCheck: true, note: "Plate is muddy" };
    const refusal = async (request: number, body: Record<string, unknown>) =>
      (await decide("pankaj", request, body)).body.error?.code;

    it("cannot approve without a photo, not even as a manual check", async () => {
      const { id, request } = await type1();
      expect(await refusal(request, approve)).toBe("PHOTO_REQUIRED");
      expect(await refusal(request, { ...override, seenPlate: PLATE })).toBe("PHOTO_REQUIRED");
      expect((await view(id)).status).toBe("SUPERVISOR_PENDING");
    });

    it("cannot simply approve a photo that does not match", async () => {
      const { id, request } = await type1();
      await photoOf(id, OTHER_PLATE);
      expect(await refusal(request, approve)).toBe("PLATE_NOT_CHECKED");
      expect((await view(id)).status).toBe("SUPERVISOR_PENDING");
    });

    it("approves one character different once the supervisor has looked", async () => {
      const { id, request } = await type1();
      await photoOf(id, CLOSE_PLATE);
      expect(await refusal(request, approve)).toBe("PLATE_NOT_CHECKED");
      const { body } = await decide("pankaj", request, { ...approve, manualCheck: true });
      expect(body.approval).toMatchObject({ status: "APPROVED", matchResult: "CLOSE" });
      expect((await view(id)).status).toBe("READY_FOR_SECOND");
    });

    it("needs a reason of 10 letters for a plate that does not match", async () => {
      const { id, request } = await type1();
      await photoOf(id, OTHER_PLATE);
      expect(await refusal(request, { ...approve, manualCheck: true })).toBe("REASON_REQUIRED");
      expect(await refusal(request, { ...override, note: "too short" })).toBe("REASON_REQUIRED");
      expect(await refusal(request, { ...approve, note: "Plate is muddy" })).toBe(
        "PLATE_NOT_CHECKED",
      );
      expect((await view(id)).status).toBe("SUPERVISOR_PENDING");
    });

    it("approves a mismatch with a reason, marked on the timeline", async () => {
      const { id, request } = await type1();
      await photoOf(id, OTHER_PLATE);
      const response = await decide("pankaj", request, override);
      expect(response.status).toBe(200);
      expect(response.body.approval).toMatchObject({
        matchResult: "NO_MATCH",
        reason: "Plate is muddy",
        manualPlate: null,
        decidedBy: "Pankaj Gupta",
        decidedAt: expect.any(String),
      });
      const event = (await view(id)).timeline.find((e) => e.type === "SUPERVISOR_APPROVED");
      expect(event?.data).toMatchObject({
        manualCheck: true,
        note: "Plate is muddy",
        plateMatch: false,
        matchResult: "NO_MATCH",
      });
    });

    it("logs a manual check of an unread photo with the plate the supervisor typed", async () => {
      const { id, request } = await type1();
      await photoOf(id, null);
      expect(await refusal(request, override)).toBe("SEEN_PLATE_REQUIRED");
      expect(await refusal(request, { ...override, seenPlate: OTHER_PLATE })).toBe("PLATE_DIFFERS");
      expect((await decide("pankaj", request, { ...override, seenPlate: "hello" })).status).toBe(
        400,
      );

      const { body } = await decide("pankaj", request, { ...override, seenPlate: "mh 12 ab-1234" });
      expect(body.approval).toMatchObject({
        status: "APPROVED",
        matchResult: "MANUAL",
        manualPlate: PLATE,
        plateRead: null,
        reason: "Plate is muddy",
      });
      const event = (await view(id)).timeline.find((e) => e.type === "SUPERVISOR_APPROVED");
      expect(event?.data).toMatchObject({ matchResult: "MANUAL", seenPlate: PLATE });
    });

    it("approves once when the button is tapped twice", async () => {
      const { id, request } = await type1();
      await photoOf(id, PLATE);
      const tap = () =>
        h.call<{ approval: ApprovalView }>(
          "pankaj",
          "POST",
          `/api/approvals/${request}/decide`,
          approve,
          { "idempotency-key": "one-tap" },
        );
      const [first, second] = await Promise.all([tap(), tap()]);
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(second.body).toEqual(first.body);
      expect([first, second].filter((r) => r.headers["idempotent-replayed"])).toHaveLength(1);
      expect((await h.eventTypes(id)).filter((t) => t === "SUPERVISOR_APPROVED")).toHaveLength(1);
      // A new press after that is told that it is already decided.
      expect(await refusal(request, approve)).toBe("ALREADY_DECIDED");
    });

    it("rejects: the truck is blocked, with no second weight and no final slip", async () => {
      const { id, request } = await type1();
      const { body } = await decide("pankaj", request, reject);
      expect(body.ticket).toMatchObject({ status: "BLOCKED", finalWeightKg: null });
      expect(body.approval).toMatchObject({ status: "REJECTED", reason: "Wrong vehicle" });

      await h.settle(EMPTY);
      const second = await post(id, "second-weight");
      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe("NOT_APPROVED");
      expect((await post(id, "printed", { kind: "FINAL" })).status).toBe(409);
    });
  });

  describe("Type 2 check", () => {
    it("saves the held weight when approved", async () => {
      const { id, request } = await type2();
      const held = await h.ticketRow(id);
      h.leave();
      const { body } = await decide("store", request, approve);

      expect(body.ticket).toMatchObject({
        status: "READY_FOR_SECOND",
        firstWeightKg: LOADED,
        heldWeightKg: LOADED,
        tripNo: 1,
        unloadingPoint: { code: "Plant" },
      });
      // The time of the weighing, not of the approval.
      expect(body.ticket?.firstWeightAt).toBe(held.firstWeightAt!.toISOString());
      expect((await secondWeight(id)).body.status).toBe("COMPLETED");
    });

    it("rejects the truck", async () => {
      const { request } = await type2();
      const { body } = await decide("store", request, reject);
      expect(body.ticket).toMatchObject({ status: "REJECTED", firstWeightKg: null, tripNo: null });
    });

    it("gives two trucks approved at once different trip numbers", async () => {
      const first = await type2(PLATE);
      const second = await type2(OTHER_PLATE);
      const answers = await Promise.all([
        decide("store", first.request, approve),
        decide("store", second.request, approve),
      ]);
      expect(answers.map((answer) => answer.body.ticket?.tripNo).sort()).toEqual([1, 2]);
    });
  });

  describe("HOLD", () => {
    it.each([
      ["NET", "MEASURED_NET", 14_310],
      ["INVOICE", "INVOICE_WEIGHT", 14_500],
    ])("completes with the %s weight", async (choice, stored, kg) => {
      const { request } = await onHold();
      const { status, body } = await decide("store", request, {
        ...approve,
        chosenWeight: choice,
        reason: "Moisture loss",
      });
      expect(status).toBe(200);
      expect(body.approval.chosenWeight).toBe(stored);
      expect(body.ticket).toMatchObject({ status: "COMPLETED", finalWeightKg: kg, netKg: 14_310 });
    });

    it("needs a choice", async () => {
      const { id, request } = await onHold();
      const response = await decide("store", request, approve);
      expect(response.status).toBe(400);
      expect(response.body.error?.code).toBe("WEIGHT_CHOICE_REQUIRED");
      expect((await view(id)).status).toBe("HOLD_PENDING");
    });

    it("rejects the truck", async () => {
      const { request } = await onHold();
      const { body } = await decide("store", request, reject);
      expect(body.ticket).toMatchObject({ status: "REJECTED", finalWeightKg: null });
    });

    it("offers no net weight when the weights are not valid", async () => {
      const { request } = await onHold(14_500, LOADED);
      expect((await decide("store", request, { ...approve, chosenWeight: "NET" })).status).toBe(
        409,
      );
      expect(
        (await decide("store", request, { ...approve, chosenWeight: "INVOICE", reason: "Checked" }))
          .status,
      ).toBe(200);
    });

    it("offers no invoice weight when there is none", async () => {
      const { request } = await onHold("unreadable");
      const response = await decide("store", request, {
        ...approve,
        chosenWeight: "INVOICE",
        reason: "Checked",
      });
      expect(response.body.error?.code).toBe("CHOICE_NOT_AVAILABLE");
    });
  });

  describe("mismatch", () => {
    it("sets the material and sends the driver back to continue", async () => {
      const { id, request } = await mismatched();
      const { body } = await decide("store", request, {
        ...approve,
        chosenMaterial: "Sand",
      });
      expect(body.approval.chosenMaterial).toBe("Sand");
      expect(body.ticket).toMatchObject({ status: "STARTED", material: "Sand" });

      const changed = await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, {
        material: "Cement Bags",
      });
      expect(changed.body.error?.code).toBe("MATERIAL_SET_BY_STORE");
      await h.settle(LOADED);
      expect((await post(id, "first-weight")).status).toBe(200);
    });

    it("needs a known material", async () => {
      const { request } = await mismatched();
      expect((await decide("store", request, approve)).status).toBe(400);
      expect((await decide("store", request, { ...approve, chosenMaterial: "Gold" })).status).toBe(
        400,
      );
    });

    it("rejects the truck", async () => {
      const { request } = await mismatched();
      expect((await decide("store", request, reject)).body.ticket?.status).toBe("REJECTED");
    });
  });

  describe("plate warnings and help", () => {
    it("lets a blocked plate continue once approved", async () => {
      const { id, request } = await blockedPlate();
      await h.settle(LOADED);
      expect((await post(id, "first-weight")).body.error?.code).toBe("NOT_APPROVED_EARLIER");

      const { body } = await decide("store", request, { ...approve, reason: "Checked" });
      expect(body.ticket).toMatchObject({ status: "STARTED", plateCheck: "APPROVED" });
      await h.settle(LOADED);
      expect((await post(id, "first-weight")).status).toBe(200);
    });

    it("rejects the new ticket of a blocked plate", async () => {
      const { request } = await blockedPlate();
      expect((await decide("store", request, reject)).body.ticket).toMatchObject({
        status: "REJECTED",
        plateCheck: "REJECTED",
      });
    });

    it("cannot allow a ticket that has already closed", async () => {
      const { id, request } = await blockedPlate();
      await h.db.execute(`update tickets set status = 'ABANDONED' where id = ${id}`);
      expect((await decide("store", request, approve)).body.error?.code).toBe("WRONG_STAGE");
    });

    it("only marks a front/back warning as handled, and changes nothing", async () => {
      h.cameras(PLATE, OTHER_PLATE);
      h.weigh(LOADED);
      await h.call("kiosk", "POST", "/api/anpr");
      const id = await started();
      const request = await pending(id, "PLATE_WARNING");

      expect((await decide("store", request, reject)).body.error?.code).toBe("CANNOT_REJECT");
      const { body } = await decide("store", request, approve);
      expect(body.ticket).toMatchObject({ status: "STARTED", plateCheck: "NOT_NEEDED" });
      expect(await h.eventTypes(id)).toContain("REQUEST_HANDLED");
    });

    it("marks a help call without a ticket as handled", async () => {
      await h.db.execute("insert into approvals (kind) values ('DRIVER_HELP')");
      const [row] = await h.approvalRows();
      const { status, body } = await decide("store", row!.id, approve);
      expect(status).toBe(200);
      expect(body.ticket).toBeNull();
    });
  });
});
