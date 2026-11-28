import { describe, expect, it } from "vitest";
import { tickets } from "../db/schema";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("second weight", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, started, weighed, secondWeight } = flows(h);

  it("is for the logged-in kiosk only", async () => {
    await h.expectRoles("POST", "/api/tickets/1/second-weight", ["kiosk"]);
  });

  it("never takes a weight from the request", async () => {
    const id = await weighed();
    await h.settle(EMPTY);
    expect((await post(id, "second-weight", { kg: 1 })).status).toBe(400);
    expect((await h.ticketRow(id)).secondWeightKg).toBeNull();
  });

  it.each([
    ["SUPERVISOR_PENDING", "WAITING_FOR_SUPERVISOR"],
    ["BLOCKED", "NOT_APPROVED"],
    ["STARTED", "WRONG_STAGE"],
    ["STORE_PENDING", "WRONG_STAGE"],
    ["HOLD_PENDING", "WRONG_STAGE"],
    ["COMPLETED", "WRONG_STAGE"],
  ] as const)("answers 409 while the ticket is %s", async (status, code) => {
    const id = await weighed();
    await h.db.update(tickets).set({ status });
    const response = await secondWeight(id);
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe(code);
  });

  it("answers 404 and uses the same capture rule as the first weight", async () => {
    expect((await post(999, "second-weight")).status).toBe(404);
    const id = await weighed();
    h.weigh(EMPTY, { stable: false });
    expect((await post(id, "second-weight")).body.error?.code).toBe("NOT_STABLE");
  });

  // The truck unloads 14,310 kg. With 0.5 %, a variance that rounds to 0.50 passes.
  it.each([
    [14_310, 0],
    [14_382, 0.5],
    [14_239, 0.5],
  ])("passes against an invoice of %i kg", async (invoiceKg, variancePct) => {
    const id = await weighed({ invoiceKg });
    const { status, body } = await secondWeight(id);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "COMPLETED",
      secondWeightKg: EMPTY,
      netKg: 14_310,
      variancePct,
      finalWeightKg: 14_310,
      holdReason: null,
      approvals: [],
    });
    expect(body.closedAt).not.toBeNull();
  });

  it("holds a truck outside the tolerance for the store officer", async () => {
    const id = await weighed({ invoiceKg: 14_500 });
    const { body } = await secondWeight(id);
    expect(body).toMatchObject({
      status: "HOLD_PENDING",
      netKg: 14_310,
      variancePct: 1.31,
      finalWeightKg: null,
      holdReason: "weight does not match the invoice",
      closedAt: null,
      approvals: [{ kind: "HOLD", status: "PENDING" }],
    });
  });

  it.each([
    ["zero", LOADED, 0],
    ["negative", LOADED + 500, -500],
  ])("holds a %s net as weights not valid", async (_what, second, netKg) => {
    const id = await weighed();
    const { body } = await secondWeight(id, second);
    expect(body).toMatchObject({
      status: "HOLD_PENDING",
      netKg,
      variancePct: null,
      holdReason: "weights not valid",
      approvals: [{ kind: "HOLD" }],
    });
  });

  it("holds a truck that has no invoice weight to compare with", async () => {
    const id = await started({ invoiceKg: "unreadable" });
    await h.settle(LOADED);
    await post(id, "first-weight");
    // Bricks are Type 3, so the truck goes straight to the second weight.
    await secondWeight(id);
    expect(await view(id)).toMatchObject({
      status: "HOLD_PENDING",
      holdReason: "no invoice weight",
    });
  });

  it("saves one second weight when asked twice at once", async () => {
    const id = await weighed();
    await h.settle(EMPTY);
    const answers = await Promise.all([post(id, "second-weight"), post(id, "second-weight")]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(await h.approvalRows()).toEqual([]);
  });
});
