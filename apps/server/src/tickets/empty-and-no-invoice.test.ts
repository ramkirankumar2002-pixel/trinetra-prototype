// Empty trucks (one weight, and the visit is over) and loaded trucks without an invoice
// (the store officer must approve, and there is no tolerance check).
import type {
  AnprResponse,
  CreateTicketResponse,
  DetailsResponse,
  KioskCollectResponse,
  PublicTicketView,
  StoreRequestsResponse,
  StoreTicketsResponse,
  UploadLinkResponse,
} from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("empty trucks and no invoice", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, weighed, secondWeight, pending } = flows(h);

  async function newTicket(plate = PLATE) {
    const created = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate,
      language: "en",
      manual: true,
    });
    expect(created.status).toBe(201);
    return created.body.ticket;
  }
  const answer = (id: number, body: Record<string, unknown>) =>
    h.call<DetailsResponse>("kiosk", "PATCH", `/api/tickets/${id}/details`, body);
  const approveAs = async (id: number, kind: string, decision = "APPROVE") =>
    h.call("store", "POST", `/api/approvals/${await pending(id, kind)}/decide`, {
      decision,
      ...(decision === "REJECT" ? { reason: "No papers" } : {}),
    });
  const collect = async () =>
    (await h.call<KioskCollectResponse>("kiosk", "GET", "/api/kiosk/collect")).body.ready;
  const storeRequests = async () =>
    (await h.call<StoreRequestsResponse>("store", "GET", "/api/store/requests")).body.requests;

  async function sendBill(id: number) {
    const link = await h.call<UploadLinkResponse>(
      "kiosk",
      "POST",
      `/api/tickets/${id}/upload-link`,
    );
    const file = h.form({ data: await h.jpeg(), type: "image/jpeg" });
    const sent = await h.call(
      null,
      "POST",
      `/api/upload/${link.body.code}`,
      file.payload,
      file.headers,
    );
    expect(sent.status).toBe(202);
    await h.app.background.idle();
  }

  describe("an empty truck", () => {
    async function emptyTicket() {
      const { id } = await newTicket();
      expect((await answer(id, { load: "EMPTY" })).status).toBe(200);
      return id;
    }

    it("is a new ticket of a loaded truck until the driver says otherwise", async () => {
      expect(await newTicket()).toMatchObject({ load: "LOADED", noInvoice: false });
    });

    it("is weighed once, with no material, invoice or approval, and is done", async () => {
      const id = await emptyTicket();
      await h.settle(EMPTY);
      const { status, body } = await post(id, "first-weight");

      expect(status).toBe(200);
      expect(body).toMatchObject({
        load: "EMPTY",
        status: "COMPLETED",
        type: null,
        material: null,
        noInvoice: false,
        firstWeightKg: EMPTY,
        secondWeightKg: null,
        netKg: null,
        finalWeightKg: null,
        tripNo: null,
        unloadingPoint: null,
        supervisor: null,
        approvals: [],
      });
      expect(body.closedAt).not.toBeNull();
      expect(await h.eventTypes(id)).toEqual([
        "TICKET_CREATED",
        "DETAILS_SAVED",
        "EMPTY_WEIGHT_SAVED",
      ]);
    });

    it("lets the same plate come again at once, as a new visit", async () => {
      const id = await emptyTicket();
      await h.settle(EMPTY);
      await post(id, "first-weight");
      expect((await newTicket()).id).not.toBe(id);
    });

    it("takes no trip number from a material", async () => {
      const id = await emptyTicket();
      await h.settle(EMPTY);
      await post(id, "first-weight");
      h.leave();
      expect((await view(await weighed({ plate: OTHER_PLATE }))).tripNo).toBe(1);
    });

    it("has a slip to print, listed as ready until it is printed", async () => {
      const id = await emptyTicket();
      await h.settle(EMPTY);
      await post(id, "first-weight");
      expect(await collect()).toMatchObject([{ ticketId: id, plate: PLATE, slip: "FINAL" }]);
      expect((await post(id, "printed", { kind: "FINAL" })).status).toBe(200);
      expect(await collect()).toEqual([]);
    });

    it("shows in the store officer's history and on its public page", async () => {
      const id = await emptyTicket();
      await h.settle(EMPTY);
      const saved = (await post(id, "first-weight")).body;

      const history = await h.call<StoreTicketsResponse>("store", "GET", "/api/store/history");
      expect(history.body.tickets).toMatchObject([
        { ticketId: id, load: "EMPTY", status: "COMPLETED", firstWeightKg: EMPTY, material: null },
      ]);
      const shared = await h.call<PublicTicketView>(
        null,
        "GET",
        `/api/public/tickets/${saved.publicToken}`,
      );
      expect(shared.body).toMatchObject({ load: "EMPTY", firstWeightKg: EMPTY });
      expect(shared.body.timeline.map((step) => step.step)).toEqual([
        "ARRIVED",
        "PLATE_READ",
        "EMPTY_WEIGHT",
        "COMPLETED",
      ]);
    });

    it("has no material, invoice or QR code", async () => {
      const id = await emptyTicket();
      expect((await answer(id, { material: "Sand" })).body.error?.code).toBe("EMPTY_TRUCK");
      expect((await answer(id, { noInvoice: true })).body.error?.code).toBe("EMPTY_TRUCK");
      expect((await post(id, "upload-link")).status).toBe(409);
    });

    it("can be corrected to loaded before the weight", async () => {
      const id = await emptyTicket();
      const { body } = await answer(id, { load: "LOADED" });
      expect(body.ticket.load).toBe("LOADED");
      await h.settle(LOADED);
      expect((await post(id, "first-weight")).body.error?.code).toBe("DETAILS_REQUIRED");
    });

    it.each([
      ["a material", { material: "Sand" }],
      ["No invoice", { noInvoice: true }],
    ])("cannot be claimed once the driver has given %s", async (_what, given) => {
      const { id } = await newTicket();
      await answer(id, given);
      expect((await answer(id, { load: "EMPTY" })).body.error?.code).toBe("ALREADY_LOADED");
    });

    it("cannot be claimed once a bill has been sent", async () => {
      const { id } = await newTicket();
      h.invoiceReads();
      await sendBill(id);
      expect((await answer(id, { load: "EMPTY" })).body.error?.code).toBe("ALREADY_LOADED");
    });

    it("waits for the store officer if its plate was turned away earlier", async () => {
      await newTicket();
      await h.db.execute("update tickets set status = 'BLOCKED', closed_at = now()");
      const id = await emptyTicket();
      await h.settle(EMPTY);
      expect((await post(id, "first-weight")).body.error?.code).toBe("NOT_APPROVED_EARLIER");
    });

    it("needs a still weight like any other", async () => {
      const id = await emptyTicket();
      h.weigh(EMPTY, { stable: false });
      expect((await post(id, "first-weight")).status).toBe(409);
    });

    it("refuses a weight sent by the browser", async () => {
      const id = await emptyTicket();
      await h.settle(EMPTY);
      expect((await post(id, "first-weight", { kg: 1 })).status).toBe(400);
    });
  });

  describe("a loaded truck without an invoice", () => {
    async function noInvoice(material = "Bricks", plate = PLATE) {
      const { id } = await newTicket(plate);
      expect((await answer(id, { noInvoice: true })).status).toBe(200);
      expect((await answer(id, { material })).body.materialMatched).toBe(true);
      await h.settle(LOADED);
      const response = await post(id, "first-weight");
      expect(response.body.error).toBeUndefined();
      return { id, ticket: response.body };
    }

    it.each([
      ["Sand", "TYPE_1"],
      ["Cement Bags", "TYPE_2"],
      ["Bricks", "TYPE_3"],
    ])("holds %s (%s) for the store officer", async (material, type) => {
      const { id, ticket } = await noInvoice(material);
      expect(ticket).toMatchObject({
        status: "STORE_PENDING",
        type,
        noInvoice: true,
        heldWeightKg: LOADED,
        firstWeightKg: null,
        approvals: [{ kind: "STORE_TYPE2", status: "PENDING" }],
      });
      expect(await storeRequests()).toMatchObject([
        { ticket: { id, noInvoice: true, material }, approval: { kind: "STORE_TYPE2" } },
      ]);
    });

    it("is held even if the driver never pressed the button", async () => {
      const id = await weighed({ invoiceKg: null });
      expect(await view(id)).toMatchObject({ status: "STORE_PENDING", noInvoice: true });
    });

    it("goes on to the second weight once approved, and passes with no tolerance check", async () => {
      const { id } = await noInvoice("Bricks");
      await approveAs(id, "STORE_TYPE2");
      expect(await view(id)).toMatchObject({ status: "READY_FOR_SECOND", firstWeightKg: LOADED });
      h.leave();
      // Any difference at all: there is nothing to compare it with.
      const { body } = await secondWeight(id, 30_000);
      expect(body).toMatchObject({
        status: "COMPLETED",
        netKg: LOADED - 30_000,
        variancePct: null,
        finalWeightKg: LOADED - 30_000,
        holdReason: null,
        approvals: [{ kind: "STORE_TYPE2", status: "APPROVED" }],
      });
      expect(body.timeline.at(-1)!.data).toMatchObject({ noInvoice: true });
      expect(body.timeline.at(-1)!.data).not.toHaveProperty("tolerancePct");
    });

    it("still holds weights that are not valid", async () => {
      const { id } = await noInvoice("Bricks");
      await approveAs(id, "STORE_TYPE2");
      h.leave();
      expect((await secondWeight(id, LOADED + 100)).body).toMatchObject({
        status: "HOLD_PENDING",
        holdReason: "weights not valid",
      });
    });

    it("sends a Type 1 material to its supervisor too, after the store officer", async () => {
      const { id } = await noInvoice("Sand");
      await approveAs(id, "STORE_TYPE2");
      expect(await view(id)).toMatchObject({
        type: "TYPE_1",
        status: "SUPERVISOR_PENDING",
        supervisor: { name: "Pankaj Gupta" },
        approvals: [
          { kind: "STORE_TYPE2", status: "APPROVED" },
          { kind: "SUPERVISOR", status: "PENDING" },
        ],
      });
      expect((await post(id, "second-weight")).body.error?.code).toBe("WAITING_FOR_SUPERVISOR");
    });

    it("saves nothing if the store officer rejects it", async () => {
      const { id } = await noInvoice("Sand");
      await approveAs(id, "STORE_TYPE2", "REJECT");
      expect(await view(id)).toMatchObject({ status: "REJECTED", firstWeightKg: null });
    });

    it("says so on the public page", async () => {
      const { ticket } = await noInvoice();
      const shared = await h.call<PublicTicketView>(
        null,
        "GET",
        `/api/public/tickets/${ticket.publicToken}`,
      );
      expect(shared.body).toMatchObject({ noInvoice: true, load: "LOADED" });
    });

    it("drops a bill that was already read, and its QR codes", async () => {
      const { id } = await newTicket();
      h.invoiceReads();
      await sendBill(id);
      const spare = await h.call<UploadLinkResponse>(
        "kiosk",
        "POST",
        `/api/tickets/${id}/upload-link`,
      );
      const { body } = await answer(id, { noInvoice: true });
      expect(body.ticket).toMatchObject({
        noInvoice: true,
        invoice: { state: "none", number: null, weightKg: null, material: null },
      });
      const old = await h.call(null, "GET", `/api/upload/${spare.body.code}`);
      expect(old.status).toBe(410);
      expect((await h.eventTypes(id)).filter((type) => type === "NO_INVOICE")).toHaveLength(1);
    });

    it("drops a reading that ends after No invoice was pressed", async () => {
      const { id } = await newTicket();
      h.invoiceReads();
      const read = h.app.readers.readInvoice;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => (release = resolve));
      h.app.readers.readInvoice = async (...args) => {
        await waiting;
        return read(...args);
      };
      const link = await h.call<UploadLinkResponse>(
        "kiosk",
        "POST",
        `/api/tickets/${id}/upload-link`,
      );
      const file = h.form({ data: await h.jpeg(), type: "image/jpeg" });
      await h.call(null, "POST", `/api/upload/${link.body.code}`, file.payload, file.headers);
      await answer(id, { noInvoice: true });
      release();
      await h.app.background.idle();
      expect(await view(id)).toMatchObject({ noInvoice: true, invoice: { weightKg: null } });
    });

    it("has an invoice again once a file is sent on a new code", async () => {
      const { id } = await newTicket();
      await answer(id, { noInvoice: true });
      h.invoiceReads();
      await sendBill(id);
      expect(await view(id)).toMatchObject({
        noInvoice: false,
        invoice: { state: "read", weightKg: 14_310 },
      });
    });

    it("does not compare the material with a bill that was dropped", async () => {
      const { id } = await newTicket();
      h.invoiceReads();
      await sendBill(id);
      const { body } = await answer(id, { noInvoice: true, material: "Sand" });
      expect(body).toMatchObject({ materialMatched: true, ticket: { material: "Sand" } });
    });
  });

  describe("a truck with an open ticket", () => {
    it("is offered its second weight at once: no new ticket, no questions", async () => {
      const id = await weighed();
      h.leave();
      await h.settle(EMPTY);
      h.cameras(PLATE);
      const read = await h.call<AnprResponse>("kiosk", "POST", "/api/anpr");
      expect(read.body.openTicket).toMatchObject({ id, status: "READY_FOR_SECOND" });

      const again = await h.call("kiosk", "POST", "/api/tickets", {
        plate: PLATE,
        language: "en",
        manual: true,
      });
      expect(again.body.error).toMatchObject({ code: "OPEN_TICKET", details: { ticketId: id } });
      // And it cannot be turned into an empty-truck visit.
      expect((await answer(id, { load: "EMPTY" })).status).toBe(409);
      expect((await post(id, "second-weight")).body.status).toBe("COMPLETED");
    });

    it("lists a finished truck's slip as ready until it is printed", async () => {
      const id = await weighed();
      expect(await collect()).toEqual([]);
      h.leave();
      await secondWeight(id);
      expect(await collect()).toMatchObject([{ ticketId: id, slip: "FINAL" }]);
      await post(id, "printed", { kind: "FINAL" });
      expect(await collect()).toEqual([]);
    });
  });
});
