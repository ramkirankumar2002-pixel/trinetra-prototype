import type { CreateTicketResponse, DetailsResponse } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { tickets } from "../db/schema";
import { testDatabaseUrl } from "../test/env";
import { PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("PATCH /api/tickets/:id/details", { timeout: 30_000 }, () => {
  const h = useTicketHarness();

  async function newTicket(invoiceMaterial: string | null = "Cement Bags") {
    const response = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate: PLATE,
      language: "en",
      manual: true,
    });
    await h.db.update(tickets).set({ invoiceMaterial });
    return response.body.ticket.id;
  }
  const patch = (id: number, body: unknown) =>
    h.call<DetailsResponse>("kiosk", "PATCH", `/api/tickets/${id}/details`, body);

  it("is for the logged-in kiosk only", async () => {
    await h.expectRoles("PATCH", "/api/tickets/1/details", ["kiosk"], { material: "Sand" });
  });

  it.each([
    ["nothing", {}],
    ["a short phone number", { driverPhone: "12345" }],
    ["an empty name", { driverName: "  " }],
    ["a weight", { invoiceWeightKg: 10 }],
    ["a status", { status: "COMPLETED" }],
  ])("refuses %s", async (_what, body) => {
    const id = await newTicket();
    expect((await patch(id, body)).status).toBe(400);
  });

  it("refuses a material that is not in the list", async () => {
    const response = await patch(await newTicket(), { material: "Gold" });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("UNKNOWN_MATERIAL");
  });

  it("saves matching answers, keeping the driver's details off the timeline", async () => {
    const id = await newTicket("cement");
    const { status, body } = await patch(id, {
      material: "cement bags",
      supplier: "Sample Cement Depot",
      transporter: "Sri Balaji Transport",
      driverName: "Ravi Kumar",
      driverPhone: "9876500000",
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({
      materialMatched: true,
      attemptsLeft: 5,
      ticket: { material: "Cement Bags", driverPhone: "9876500000", mismatchAttempts: 0 },
    });
    expect(JSON.stringify(body.ticket.timeline)).not.toMatch(/9876500000|Ravi Kumar/);
  });

  it.each([null, "mixed goods"])(
    "accepts any material when the invoice says %s",
    async (onInvoice) => {
      const { body } = await patch(await newTicket(onInvoice), { material: "Sand" });
      expect(body.materialMatched).toBe(true);
    },
  );

  it("counts mismatches and calls the store officer on the 5th", async () => {
    const id = await newTicket();
    for (let attempt = 1; attempt <= 4; attempt++) {
      const { body } = await patch(id, { material: "Sand" });
      expect(body).toMatchObject({
        materialMatched: false,
        attemptsLeft: 5 - attempt,
        ticket: { status: "STARTED", material: null, mismatchAttempts: attempt },
      });
    }
    expect(await h.approvalRows()).toEqual([]);

    const fifth = await patch(id, { material: "Sand" });
    expect(fifth.body).toMatchObject({
      attemptsLeft: 0,
      ticket: { status: "MISMATCH_PENDING", mismatchAttempts: 5 },
    });
    expect(await h.approvalRows()).toMatchObject([{ kind: "MISMATCH", status: "PENDING" }]);
    expect(await h.eventTypes(id)).toContain("MISMATCH_LIMIT_REACHED");

    const sixth = await patch(id, { material: "Cement Bags" });
    expect(sixth.status).toBe(409);
    expect(sixth.body.error?.code).toBe("WRONG_STAGE");
  });

  it("answers 404 and 409", async () => {
    expect((await patch(999, { material: "Sand" })).status).toBe(404);
    const id = await newTicket();
    await h.db.update(tickets).set({ status: "COMPLETED" });
    expect((await patch(id, { material: "Sand" })).status).toBe(409);
  });
});
