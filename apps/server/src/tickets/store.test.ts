import type { StoreRequestsResponse } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows } from "../test/flows";
import { OTHER_PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("store requests and help", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { started, weighed, secondWeight, pending } = flows(h);

  const list = (query = "") =>
    h.call<StoreRequestsResponse>("store", "GET", `/api/store/requests${query}`);
  const decide = (id: number, body: unknown, who: "store" | "amit" = "store") =>
    h.call(who, "POST", `/api/approvals/${id}/decide`, body);
  const help = (body?: unknown) =>
    h.call<{ approvalId: number; alreadyAsked: boolean }>("kiosk", "POST", "/api/help", body);

  it("are for the right roles", async () => {
    await h.expectRoles("GET", "/api/store/requests", ["store"]);
    await h.expectRoles("POST", "/api/help", ["kiosk"]);
  });

  describe("GET /api/store/requests", () => {
    it("lists pending requests newest first, without the supervisor's", async () => {
      const held = await weighed({ material: "Sand", invoiceKg: 14_500 });
      await weighed({ plate: OTHER_PLATE, material: "Cement Bags" });
      await help({ ticketId: held });

      const { status, body } = await list();
      expect(status).toBe(200);
      expect(body.requests.map((item) => item.approval.kind)).toEqual([
        "DRIVER_HELP",
        "STORE_TYPE2",
      ]);
      expect(body.requests[1]!.ticket).toMatchObject({ id: held, status: "STORE_PENDING" });
      expect((await list("?status=done")).body.requests).toEqual([]);
    });

    it("lists done requests and the trucks a supervisor blocked", async () => {
      const blocked = await weighed({ material: "Cement Bags" });
      await decide(
        await pending(blocked, "SUPERVISOR"),
        { decision: "REJECT", reason: "Wrong vehicle" },
        "amit",
      );
      const held = await weighed({ plate: OTHER_PLATE, invoiceKg: 14_500 });
      await secondWeight(held);
      const hold = await pending(held, "HOLD");
      expect((await list()).body.requests[0]!.ticket?.holdReason).toBe(
        "weight does not match the invoice",
      );
      await decide(hold, { decision: "APPROVE", chosenWeight: "NET" });

      const done = (await list("?status=done")).body.requests;
      expect(done.map((item) => [item.approval.kind, item.approval.status])).toEqual([
        ["HOLD", "APPROVED"],
        ["SUPERVISOR", "REJECTED"],
      ]);
      expect(done[0]!.approval.decidedBy).toBe("Ram (Sr. Manager)");
    });

    it("leaves out a blocking request whose ticket has ended", async () => {
      const id = await weighed({ material: "Sand", invoiceKg: 14_500 });
      await h.db.execute(`update tickets set status = 'ABANDONED' where id = ${id}`);
      expect((await list()).body.requests).toEqual([]);
    });

    it("refuses an unknown status", async () => {
      expect((await list("?status=all")).status).toBe(400);
    });
  });

  describe("POST /api/help", () => {
    it("works before there is a ticket, once per open call", async () => {
      const first = await help();
      expect(first).toMatchObject({ status: 200, body: { alreadyAsked: false } });
      const again = await help({});
      expect(again.body).toEqual({ approvalId: first.body.approvalId, alreadyAsked: true });
      expect((await list()).body.requests).toMatchObject([
        { approval: { kind: "DRIVER_HELP" }, ticket: null },
      ]);

      await decide(first.body.approvalId, { decision: "APPROVE" });
      expect((await help()).body.alreadyAsked).toBe(false);
    });

    it("makes one call for two presses at the same moment", async () => {
      const id = await started();
      await Promise.all([help({ ticketId: id }), help({ ticketId: id })]);
      expect(await h.approvalRows()).toHaveLength(1);
      expect(await h.eventTypes(id)).toContain("APPROVAL_REQUESTED");
    });

    it("answers 404 and 400", async () => {
      expect((await help({ ticketId: 999 })).status).toBe(404);
      expect((await help({ ticketId: "1" })).status).toBe(400);
      expect((await help({ message: "hi" })).status).toBe(400);
    });
  });
});
