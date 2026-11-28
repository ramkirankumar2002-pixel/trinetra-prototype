// What the store officer's website uses (Phase 13): its lists and numbers, the bill
// uploaded for a driver without a phone, and the rules and audit of every decision.
import type {
  ApprovalView,
  CreateTicketResponse,
  StoreRequestView,
  StoreSummaryResponse,
  StoreTicketsResponse,
  TicketView,
} from "@trinetra/shared";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ticketEvents } from "../db/schema";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("the store officer's pages", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, started, weighed, secondWeight, pending } = flows(h);

  const decide = (id: number, body: unknown, headers: Record<string, string> = {}) =>
    h.call<{ approval: ApprovalView; ticket: TicketView | null }>(
      "store",
      "POST",
      `/api/approvals/${id}/decide`,
      body,
      headers,
    );
  const get = <T>(url: string) => h.call<T>("store", "GET", url);
  const summary = async () => (await get<StoreSummaryResponse>("/api/store/summary")).body;
  const trucks = async () => (await get<StoreTicketsResponse>("/api/store/trucks")).body.tickets;
  const history = async (q = "") =>
    (await get<StoreTicketsResponse>(`/api/store/history?q=${encodeURIComponent(q)}`)).body.tickets;
  const lastEvent = async (ticketId: number, type: string) =>
    (
      await h.db
        .select()
        .from(ticketEvents)
        .where(eq(ticketEvents.ticketId, ticketId))
        .orderBy(asc(ticketEvents.id))
    )
      .filter((row) => row.type === type)
      .at(-1)!;

  /** On HOLD: 14,310 kg weighed against `invoiceKg` on the bill. */
  async function onHold(invoiceKg = 14_500, plate = PLATE) {
    const id = await weighed({ plate, invoiceKg });
    await secondWeight(id);
    return { id, request: await pending(id, "HOLD") };
  }

  /** A plate that was rejected today and is back: the new visit waits for the officer. */
  async function blockedAgain() {
    const first = await weighed({ material: "Cement Bags", invoiceKg: 14_310 });
    await decide(await pending(first, "STORE_TYPE2"), {
      decision: "REJECT",
      reason: "Wrong load",
    });
    const id = await started();
    return { id, request: await pending(id, "PLATE_WARNING") };
  }

  it("are only for the store officer", async () => {
    await h.expectRoles("GET", "/api/store/summary", ["store"]);
    await h.expectRoles("GET", "/api/store/trucks", ["store"]);
    await h.expectRoles("GET", "/api/store/history", ["store"]);
    await h.expectRoles("GET", "/api/store/requests/1", ["store"]);
    await h.expectRoles("POST", "/api/store/requests/1/invoice", ["store"]);
  });

  describe("a Type 2 truck", () => {
    it("approved: the held weight is saved, and the decision is on record", async () => {
      const id = await weighed({ material: "Cement Bags", invoiceKg: 14_310 });
      const request = await pending(id, "STORE_TYPE2");
      expect(await view(id)).toMatchObject({ heldWeightKg: LOADED, firstWeightKg: null });

      const answer = await decide(request, { decision: "APPROVE" });
      expect(answer.status).toBe(200);
      expect(answer.body.ticket).toMatchObject({
        status: "READY_FOR_SECOND",
        firstWeightKg: LOADED,
      });
      expect(answer.body.approval).toMatchObject({
        status: "APPROVED",
        decidedBy: "Ram (Sr. Manager)",
      });
      expect(answer.body.approval.decidedAt).not.toBeNull();
      const event = await lastEvent(id, "STORE_APPROVED");
      expect(event.actor).toBe(`user:${h.userId("store")}`);
      expect(event.data).toMatchObject({ from: "STORE_PENDING", to: "READY_FOR_UNLOAD" });
    });

    it("rejected: only with a reason, and the truck must leave", async () => {
      const id = await weighed({ material: "Cement Bags", invoiceKg: 14_310 });
      const request = await pending(id, "STORE_TYPE2");
      expect((await decide(request, { decision: "REJECT" })).status).toBe(400);

      const answer = await decide(request, { decision: "REJECT", reason: "Wrong material" });
      expect(answer.body.ticket).toMatchObject({ status: "REJECTED", firstWeightKg: null });
      expect(answer.body.approval.reason).toBe("Wrong material");
      expect((await lastEvent(id, "STORE_REJECTED")).data).toMatchObject({
        from: "STORE_PENDING",
        to: "REJECTED",
        reason: "Wrong material",
      });
    });
  });

  describe("a HOLD", () => {
    const printable = async (id: number) => (await view(id)).finalWeightKg;

    it("accepting the net weight puts the net weight on the slip", async () => {
      const { id, request } = await onHold();
      expect((await decide(request, { decision: "APPROVE", chosenWeight: "NET" })).status).toBe(
        200,
      );
      expect(await printable(id)).toBe(LOADED - EMPTY);
    });

    it("accepting the invoice weight needs a reason, then it is on the slip", async () => {
      const { id, request } = await onHold();
      const without = await decide(request, { decision: "APPROVE", chosenWeight: "INVOICE" });
      expect(without).toMatchObject({ status: 409, body: { error: { code: "REASON_REQUIRED" } } });
      expect((await view(id)).status).toBe("HOLD_PENDING");

      const answer = await decide(request, {
        decision: "APPROVE",
        chosenWeight: "INVOICE",
        reason: "Moisture loss",
      });
      expect(answer.body.approval).toMatchObject({
        chosenWeight: "INVOICE_WEIGHT",
        reason: "Moisture loss",
      });
      expect(await printable(id)).toBe(14_500);
      expect((await lastEvent(id, "HOLD_APPROVED")).data).toMatchObject({
        from: "HOLD_PENDING",
        to: "COMPLETED",
        reason: "Moisture loss",
        acceptedKg: 14_500,
      });
    });

    it("rejected: only with a reason, and no weight is accepted", async () => {
      const { id, request } = await onHold();
      expect((await decide(request, { decision: "REJECT" })).status).toBe(400);
      await decide(request, { decision: "REJECT", reason: "Short load" });
      expect(await view(id)).toMatchObject({ status: "REJECTED", finalWeightKg: null });
    });

    it("saves the limit it was judged by, for the page to show", async () => {
      const { id } = await onHold();
      expect((await lastEvent(id, "SECOND_WEIGHT_FAILED")).data).toMatchObject({
        netKg: LOADED - EMPTY,
        invoiceWeightKg: 14_500,
        tolerancePct: 0.5,
        variancePct: 1.31,
      });
    });
  });

  describe("a blocked plate that came back", () => {
    it("is allowed only with a reason", async () => {
      const { id, request } = await blockedAgain();
      const without = await decide(request, { decision: "APPROVE" });
      expect(without.body.error?.code).toBe("REASON_REQUIRED");
      expect((await view(id)).plateCheck).toBe("PENDING");

      await decide(request, { decision: "APPROVE", reason: "Checked in person" });
      expect(await view(id)).toMatchObject({ plateCheck: "APPROVED", status: "STARTED" });
      expect((await lastEvent(id, "PLATE_WARNING_APPROVED")).data).toMatchObject({
        from: "STARTED",
        to: "STARTED",
        reason: "Checked in person",
      });
    });

    it("says which earlier ticket caused the check", async () => {
      const { id } = await blockedAgain();
      expect((await lastEvent(id, "APPROVAL_REQUESTED")).data).toMatchObject({
        earlierStatus: "REJECTED",
        earlierTicketNo: (await h.allTickets())[0]!.ticketNo,
      });
    });

    it("rejected: the new visit ends", async () => {
      const { id, request } = await blockedAgain();
      await decide(request, { decision: "REJECT", reason: "Blocked earlier" });
      expect((await view(id)).status).toBe("REJECTED");
    });
  });

  describe("a material mismatch", () => {
    async function mismatched() {
      const id = await started({ material: "Sand" });
      await h.db.execute(`update tickets set invoice_material = 'Sand' where id = ${id}`);
      for (let n = 0; n < 5; n++) {
        await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Cement Bags" });
      }
      return { id, request: await pending(id, "MISMATCH") };
    }

    it("is fixed by choosing the material, and the visit goes on", async () => {
      const { id, request } = await mismatched();
      const answer = await decide(request, { decision: "APPROVE", chosenMaterial: "Bricks" });
      expect(answer.body.ticket).toMatchObject({ status: "STARTED", material: "Bricks" });
      expect(answer.body.approval.chosenMaterial).toBe("Bricks");
      expect((await lastEvent(id, "MISMATCH_RESOLVED")).data).toMatchObject({
        from: "MISMATCH_PENDING",
        to: "STARTED",
      });
    });

    it("or rejected", async () => {
      const { id, request } = await mismatched();
      await decide(request, { decision: "REJECT", reason: "Wrong bill" });
      expect((await view(id)).status).toBe("REJECTED");
    });
  });

  describe("deciding once", () => {
    it("answers a repeat of the same press with the first answer", async () => {
      const { id, request } = await onHold();
      const body = { decision: "APPROVE", chosenWeight: "NET" };
      const key = { "idempotency-key": "store-press-1" };
      const first = await decide(request, body, key);
      const again = await decide(request, body, key);
      expect(again.status).toBe(200);
      expect(again.headers["idempotent-replayed"]).toBe("true");
      expect(again.body).toEqual(first.body);
      expect((await h.eventTypes(id)).filter((type) => type === "HOLD_APPROVED")).toHaveLength(1);
    });

    it("lets only one of two presses at the same moment act", async () => {
      const { request } = await onHold();
      const answers = await Promise.all([
        decide(request, { decision: "APPROVE", chosenWeight: "NET" }),
        decide(request, { decision: "REJECT", reason: "Short load" }),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    });

    it("says ALREADY_DECIDED for a request already answered", async () => {
      const { request } = await onHold();
      await decide(request, { decision: "APPROVE", chosenWeight: "NET" });
      const late = await decide(request, { decision: "REJECT", reason: "Late" });
      expect(late.body.error?.code).toBe("ALREADY_DECIDED");
    });

    it("says WRONG_STAGE when the ticket has moved on", async () => {
      const id = await weighed({ material: "Cement Bags", invoiceKg: 14_310 });
      const request = await pending(id, "STORE_TYPE2");
      await h.db.execute(`update tickets set status = 'ABANDONED' where id = ${id}`);
      const answer = await decide(request, { decision: "APPROVE" });
      expect(answer).toMatchObject({ status: 409, body: { error: { code: "WRONG_STAGE" } } });
    });
  });

  describe("one request", () => {
    it("is read with its ticket, before and after the decision", async () => {
      const { id, request } = await onHold();
      const before = await get<StoreRequestView>(`/api/store/requests/${request}`);
      expect(before.body).toMatchObject({
        approval: { id: request, kind: "HOLD", status: "PENDING" },
        ticket: { id, holdReason: "weight does not match the invoice", netKg: LOADED - EMPTY },
      });
      await decide(request, { decision: "APPROVE", chosenWeight: "NET" });
      const after = await get<StoreRequestView>(`/api/store/requests/${request}`);
      expect(after.body.approval).toMatchObject({ status: "APPROVED" });
    });

    it("is not a supervisor's waiting check, and 404 if there is none", async () => {
      const id = await weighed({ material: "Sand" });
      const request = await pending(id, "SUPERVISOR");
      expect((await get(`/api/store/requests/${request}`)).status).toBe(404);
      expect((await get("/api/store/requests/999")).status).toBe(404);
      expect((await get("/api/store/requests/abc")).status).toBe(400);
    });
  });

  describe("numbers, trucks on site and history", () => {
    it("starts at zero", async () => {
      expect(await summary()).toEqual({
        waiting: 0,
        approved: 0,
        rejected: 0,
        onHold: 0,
        onSite: 0,
        completed: 0,
      });
      expect(await trucks()).toEqual([]);
      expect(await history()).toEqual([]);
    });

    it("counts real tickets and the store officer's decisions of today", async () => {
      const held = await onHold();
      const waitingTruck = await weighed({
        plate: OTHER_PLATE,
        material: "Cement Bags",
        invoiceKg: 14_310,
      });
      expect(await summary()).toMatchObject({ waiting: 2, onHold: 1, onSite: 2, completed: 0 });

      const onSite = await trucks();
      expect(onSite.map((truck) => [truck.ticketId, truck.status])).toEqual([
        [held.id, "HOLD_PENDING"],
        [waitingTruck, "STORE_PENDING"],
      ]);
      expect(onSite[0]).toMatchObject({
        pendingStoreApprovalId: held.request,
        netKg: LOADED - EMPTY,
        decisions: [],
      });

      await decide(held.request, { decision: "APPROVE", chosenWeight: "NET" });
      await decide(await pending(waitingTruck, "STORE_TYPE2"), {
        decision: "REJECT",
        reason: "Wrong load",
      });
      expect(await summary()).toEqual({
        waiting: 0,
        approved: 1,
        rejected: 1,
        onHold: 0,
        onSite: 0,
        completed: 1,
      });
      expect(await trucks()).toEqual([]);
    });

    it("does not count 'handled' as approved, or a supervisor's decision", async () => {
      const id = await weighed({ material: "Sand" });
      await h.call("pankaj", "POST", `/api/approvals/${await pending(id, "SUPERVISOR")}/decide`, {
        decision: "REJECT",
        reason: "Wrong truck",
      });
      await h.call("kiosk", "POST", "/api/help", {});
      const help = (await h.approvalRows()).find((row) => row.kind === "DRIVER_HELP")!;
      await decide(help.id, { decision: "APPROVE" });
      expect(await summary()).toMatchObject({ approved: 0, rejected: 0 });
    });

    it("lists today's ended tickets with who decided what, newest first", async () => {
      const first = await onHold();
      await decide(first.request, {
        decision: "APPROVE",
        chosenWeight: "INVOICE",
        reason: "Moisture loss",
      });
      const second = await weighed({ plate: OTHER_PLATE, material: "Sand" });
      await h.call(
        "pankaj",
        "POST",
        `/api/approvals/${await pending(second, "SUPERVISOR")}/decide`,
        {
          decision: "REJECT",
          reason: "Wrong truck",
        },
      );

      const rows = await history();
      expect(rows.map((row) => [row.ticketId, row.status])).toEqual([
        [second, "BLOCKED"],
        [first.id, "COMPLETED"],
      ]);
      expect(rows[1]).toMatchObject({
        netKg: LOADED - EMPTY,
        invoiceWeightKg: 14_500,
        variancePct: 1.31,
        finalWeightKg: 14_500,
        decisions: [
          {
            kind: "HOLD",
            status: "APPROVED",
            decidedBy: "Ram (Sr. Manager)",
            chosenWeight: "INVOICE_WEIGHT",
            reason: "Moisture loss",
          },
        ],
      });
      expect(rows[0]!.decisions).toMatchObject([{ kind: "SUPERVISOR", decidedBy: "Pankaj Gupta" }]);
    });

    it("searches by plate, written any way, or by ticket number", async () => {
      const { id, request } = await onHold();
      await decide(request, { decision: "APPROVE", chosenWeight: "NET" });
      const { ticketNo } = await h.ticketRow(id);
      for (const q of ["mh 12 ab 1234", "AB-1234", ticketNo, ticketNo.slice(-4)]) {
        expect(await history(q), q).toHaveLength(1);
      }
      for (const q of ["MH14CD5678", "%", "_", "--", "\\"]) {
        expect(await history(q), q).toEqual([]);
      }
      expect((await get(`/api/store/history?q=${"a".repeat(41)}`)).status).toBe(400);
    });

    it("leaves out older tickets and abandoned ones", async () => {
      const { id, request } = await onHold();
      await decide(request, { decision: "APPROVE", chosenWeight: "NET" });
      await h.db.execute(
        `update tickets set closed_at = now() - interval '2 days' where id = ${id}`,
      );
      const walked = await started({ plate: OTHER_PLATE });
      await h.db.execute(
        `update tickets set status = 'ABANDONED', closed_at = now() where id = ${walked}`,
      );
      expect(await history()).toEqual([]);
      expect(await summary()).toMatchObject({ completed: 0, onSite: 0 });
    });
  });

  describe("the bill of a driver without a phone", () => {
    /** At the invoice screen, "No phone?" pressed. */
    async function noPhone() {
      const created = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
        plate: PLATE,
        language: "en",
        manual: true,
      });
      const id = created.body.ticket.id;
      const help = await h.call<{ approvalId: number }>("kiosk", "POST", "/api/help", {
        ticketId: id,
      });
      return { id, request: help.body.approvalId };
    }

    async function upload(
      request: number,
      file?: { data: Buffer; type: string },
      headers: Record<string, string> = {},
    ) {
      const body = h.form(file ?? { data: await h.jpeg(), type: "image/jpeg" });
      const answer = await h.call(
        "store",
        "POST",
        `/api/store/requests/${request}/invoice`,
        body.payload,
        { ...body.headers, ...headers },
      );
      await h.app.background.idle();
      return answer;
    }

    it("is read like the driver's own, and answers the call for help", async () => {
      const { id, request } = await noPhone();
      h.invoiceReads({ invoice_number: "STORE-1" });
      const rooms = vi.spyOn(h.app.realtime.io, "to");

      expect((await upload(request)).status).toBe(202);
      const ticket = await view(id);
      expect(ticket.invoice).toMatchObject({ state: "read", number: "STORE-1", weightKg: 14_310 });
      expect(ticket.photos.filter((photo) => photo.kind === "INVOICE")).toHaveLength(1);
      expect(ticket.approvals).toMatchObject([
        {
          id: request,
          status: "APPROVED",
          decidedBy: "Ram (Sr. Manager)",
          reason: "Bill uploaded for the driver",
        },
      ]);
      const handled = await lastEvent(id, "REQUEST_HANDLED");
      expect(handled.actor).toBe(`user:${h.userId("store")}`);
      expect(handled.data).toMatchObject({ from: "STARTED", to: "STARTED" });
      expect((await lastEvent(id, "INVOICE_RECEIVED")).actor).toBe(`user:${h.userId("store")}`);
      // The kiosk is told to go on.
      expect(rooms.mock.calls.flatMap(([to]) => String(to))).toContain("kiosk");
      rooms.mockRestore();
    });

    it("keeps the call open when the bill cannot be read, to try again", async () => {
      const { id, request } = await noPhone();
      h.app.readers.readInvoice = () => Promise.reject(new Error("no reader"));
      expect((await upload(request)).status).toBe(202);
      expect((await view(id)).invoice.state).toBe("failed");
      expect((await h.approvalRows())[0]!.status).toBe("PENDING");

      h.invoiceReads();
      expect((await upload(request)).status).toBe(202);
      expect((await view(id)).invoice.state).toBe("read");
      expect((await h.approvalRows())[0]!.status).toBe("APPROVED");
    });

    it("takes one file for one press, however often it is sent", async () => {
      const { id, request } = await noPhone();
      h.invoiceReads();
      const key = { "idempotency-key": "bill-1" };
      const data = await h.jpeg();
      await upload(request, { data, type: "image/jpeg" }, key);
      const again = await upload(request, { data, type: "image/jpeg" }, key);
      expect(again.status).toBe(202);
      expect((await h.eventTypes(id)).filter((type) => type === "INVOICE_RECEIVED")).toHaveLength(
        1,
      );
    });

    it("is refused once answered, for another kind of request, or after the start", async () => {
      const { id, request } = await noPhone();
      await decide(request, { decision: "APPROVE" });
      expect((await upload(request)).body.error?.code).toBe("ALREADY_DECIDED");

      const again = (
        await h.call<{ approvalId: number }>("kiosk", "POST", "/api/help", { ticketId: id })
      ).body.approvalId;
      await h.db.execute(`update tickets set status = 'ABANDONED' where id = ${id}`);
      expect((await upload(again)).body.error?.code).toBe("WRONG_STAGE");

      const other = await weighed({
        plate: OTHER_PLATE,
        material: "Cement Bags",
        invoiceKg: 14_310,
      });
      expect((await upload(await pending(other, "STORE_TYPE2"))).body.error?.code).toBe(
        "WRONG_STAGE",
      );
      expect((await upload(999)).status).toBe(404);
    });

    it("needs a ticket", async () => {
      const help = await h.call<{ approvalId: number }>("kiosk", "POST", "/api/help", {});
      expect((await upload(help.body.approvalId)).body.error?.code).toBe("WRONG_STAGE");
    });

    it("takes only a photo or a PDF", async () => {
      const { request } = await noPhone();
      expect(
        (await upload(request, { data: Buffer.from("hello"), type: "text/plain" })).status,
      ).toBe(415);
      const nothing = await h.call("store", "POST", `/api/store/requests/${request}/invoice`, {});
      expect(nothing.body.error?.code).toBe("NO_FILE");
    });
  });

  describe('"No phone?" says that a bill is needed', () => {
    const press = (body: Record<string, unknown>) => h.call("kiosk", "POST", "/api/help", body);
    const waiting = async () =>
      (await get<{ requests: StoreRequestView[] }>("/api/store/requests")).body.requests;

    it("on a new call, and not on a plain call for help", async () => {
      const id = await started();
      await press({ ticketId: id });
      expect(await waiting()).toMatchObject([{ needsBill: false }]);
      expect(await h.eventTypes(id)).not.toContain("NO_PHONE");

      const other = await started({ plate: OTHER_PLATE });
      await press({ ticketId: other, noPhone: true });
      expect((await waiting()).find((row) => row.ticket?.id === other)!.needsBill).toBe(true);
    });

    it("also after Help, once, and tells the store officer", async () => {
      const id = await started();
      await press({ ticketId: id });
      const rooms = vi.spyOn(h.app.realtime.io, "to");
      await press({ ticketId: id, noPhone: true });
      await press({ ticketId: id, noPhone: true });
      expect(rooms.mock.calls.filter(([to]) => String(to) === "store")).toHaveLength(1);
      rooms.mockRestore();
      expect((await h.eventTypes(id)).filter((type) => type === "NO_PHONE")).toHaveLength(1);
      expect(await h.approvalRows()).toHaveLength(1);
      expect(await waiting()).toMatchObject([{ needsBill: true }]);
    });

    it("no longer once the bill has been read, or the call is answered", async () => {
      const id = await started();
      await press({ ticketId: id, noPhone: true });
      await h.db.execute(
        `insert into ticket_events (ticket_id, type, actor) values (${id}, 'INVOICE_READ', 'system')`,
      );
      expect(await waiting()).toMatchObject([{ needsBill: false }]);
      const [request] = await waiting();
      await decide(request!.approval.id, { decision: "APPROVE" });
      const done = await get<StoreRequestView>(`/api/store/requests/${request!.approval.id}`);
      expect(done.body.needsBill).toBe(false);
    });

    it("refuses anything else in the call", async () => {
      expect((await press({ noPhone: "yes" })).status).toBe(400);
    });
  });

  describe("cancelling a visit that waits for a person", () => {
    const cancel = (id: number, body: unknown = { reason: "Truck has left the site" }) =>
      h.call<TicketView>("store", "POST", `/api/store/tickets/${id}/cancel`, body);
    const helpOn = async (ticketId: number) =>
      (await h.call<{ approvalId: number }>("kiosk", "POST", "/api/help", { ticketId })).body
        .approvalId;
    const type2 = () => weighed({ material: "Cement Bags", invoiceKg: 14_500 });

    it("is only for the store officer", async () => {
      await h.expectRoles("POST", "/api/store/tickets/1/cancel", ["store"], { reason: "x" });
    });

    it("needs a reason, and nothing else", async () => {
      const id = await type2();
      for (const body of [{}, { reason: "  " }, { reason: "x", status: "COMPLETED" }]) {
        expect((await cancel(id, body)).status).toBe(400);
      }
      expect((await view(id)).status).toBe("STORE_PENDING");
    });

    it("ends it, on record, and empties the queues", async () => {
      const id = await type2();
      const answer = await cancel(id);
      expect(answer.status).toBe(200);
      expect(answer.body.status).toBe("ABANDONED");
      expect(answer.body.closedAt).not.toBeNull();

      const event = await lastEvent(id, "STORE_CANCELLED");
      expect(event.actor).toBe(`user:${h.userId("store")}`);
      expect(event.data).toMatchObject({
        from: "STORE_PENDING",
        to: "ABANDONED",
        reason: "Truck has left the site",
      });
      expect(await summary()).toMatchObject({ waiting: 0, onSite: 0, approved: 0, rejected: 0 });
      expect(await trucks()).toEqual([]);
      expect(await history()).toMatchObject([
        {
          ticketId: id,
          status: "ABANDONED",
          cancelled: { by: "Ram (Sr. Manager)", reason: "Truck has left the site" },
        },
      ]);
    });

    it("takes a supervisor's waiting truck off their list; nobody can decide it", async () => {
      const id = await weighed({ material: "Sand" });
      const request = await pending(id, "SUPERVISOR");
      const rooms = vi.spyOn(h.app.realtime.io, "to");
      expect((await cancel(id)).status).toBe(200);
      // The supervisor's phone is told at once.
      expect(rooms.mock.calls.flatMap(([to]) => String(to)).join()).toContain(
        `supervisor:${h.userId("pankaj")}`,
      );
      rooms.mockRestore();

      const mine = await h.call<{ tickets: unknown[] }>(
        "pankaj",
        "GET",
        "/api/supervisor/tickets?status=pending",
      );
      expect(mine.body.tickets).toEqual([]);
      const late = await h.call("pankaj", "POST", `/api/approvals/${request}/decide`, {
        decision: "REJECT",
        reason: "Wrong truck",
      });
      expect(late.body.error?.code).toBe("WRONG_STAGE");
      // Cancelled is not rejected: it is not shown as a truck the supervisor blocked.
      expect((await history())[0]).toMatchObject({ status: "ABANDONED", decisions: [] });
    });

    it("closes the driver's call for help with it", async () => {
      const id = await started();
      const call = await helpOn(id);
      expect((await cancel(id)).status).toBe(200);
      const row = (await h.approvalRows()).find((item) => item.id === call)!;
      expect(row).toMatchObject({
        status: "APPROVED",
        decidedBy: h.userId("store"),
        reason: "Visit cancelled: Truck has left the site",
      });
      expect((await get<{ requests: unknown[] }>("/api/store/requests")).body.requests).toEqual([]);
    });

    it("is refused while it is the driver's turn, and once it has ended", async () => {
      const id = await started();
      expect(await cancel(id)).toMatchObject({
        status: 409,
        body: { error: { code: "WRONG_STAGE" } },
      });
      await helpOn(id);
      await cancel(id);
      expect((await cancel(id)).body.error?.code).toBe("WRONG_STAGE");
      expect((await cancel(999)).status).toBe(404);
    });

    it("lets the plate come again: cancelled is not rejected", async () => {
      await cancel(await weighed({ material: "Sand" }));
      const next = await started();
      expect((await view(next)).plateCheck).toBe("NOT_NEEDED");
    });

    it("shows how long a truck on site has waited, and nothing for a driver's turn", async () => {
      const driving = await started();
      const waiting = await weighed({ plate: OTHER_PLATE, material: "Sand" });
      const rows = await trucks();
      expect(rows.find((row) => row.ticketId === driving)!.waitingSince).toBeNull();
      expect(rows.find((row) => row.ticketId === waiting)!.waitingSince).not.toBeNull();
    });
  });

  describe("bitumen trips", () => {
    it("go to Suresh Yadav for trips 1 and 2, and to Pankaj Gupta after", async () => {
      const seen: (string | undefined)[] = [];
      for (const plate of [PLATE, OTHER_PLATE, "UP32EF9012"]) {
        const id = await weighed({ plate, material: "Bitumen", invoiceKg: 900 });
        seen.push((await view(id)).supervisor?.name);
        h.leave();
      }
      expect(seen).toEqual(["Suresh Yadav", "Suresh Yadav", "Pankaj Gupta"]);
    });
  });

  // The kiosk's routes are untouched by the store's upload.
  it("still refuses the kiosk a weight after a refused decision", async () => {
    const id = await started();
    expect((await post(id, "second-weight")).status).toBe(409);
  });
});
