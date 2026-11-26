import type {
  CreateTicketResponse,
  KioskCollectResponse,
  MasterResponse,
  StoreRequestsResponse,
  TicketView,
} from "@trinetra/shared";
import { SEED_MATERIALS, SEED_SUPPLIERS, SEED_TRANSPORTERS } from "@trinetra/shared/seed";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { kioskCollect, NOT_APPROVED_SHOWN_MS } from "./collect";

describe.skipIf(!testDatabaseUrl)("the kiosk's lists", { timeout: 30_000 }, () => {
  const h = useTicketHarness();

  /** A Type 2 truck whose first weight is held for the store officer. */
  async function heldTruck(plate: string) {
    const { body } = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate,
      language: "en",
      manual: true,
    });
    const id = body.ticket.id;
    h.invoiceReads({ material: "MS Steel Scrap", quantity: 1500, quantity_unit: "kg" });
    const link = await h.call<{ code: string }>("kiosk", "POST", `/api/tickets/${id}/upload-link`);
    const file = h.form({ data: await h.jpeg(), type: "image/jpeg" });
    await h.call(null, "POST", `/api/upload/${link.body.code}`, file.payload, file.headers);
    await h.app.background.idle();
    await h.call("kiosk", "PATCH", `/api/tickets/${id}/details`, { material: "Steel Scrap" });
    await h.settle(19_750);
    const weighed = await h.call<TicketView>("kiosk", "POST", `/api/tickets/${id}/first-weight`);
    expect(weighed.body.status).toBe("STORE_PENDING");
    return id;
  }

  async function storeDecides(ticketId: number, decision: "APPROVE" | "REJECT") {
    const list = await h.call<StoreRequestsResponse>("store", "GET", "/api/store/requests");
    const request = list.body.requests.find((item) => item.ticket?.id === ticketId)!;
    await h.call("store", "POST", `/api/approvals/${request.approval.id}/decide`, {
      decision,
      ...(decision === "REJECT" ? { reason: "Wrong material" } : {}),
    });
  }

  const lists = async () =>
    (await h.call<KioskCollectResponse>("kiosk", "GET", "/api/kiosk/collect")).body;

  it("are for the kiosk only", async () => {
    await h.expectRoles("GET", "/api/kiosk/collect", ["kiosk"]);
    await h.expectRoles("GET", "/api/master", ["kiosk"]);
  });

  it("GET /api/master gives the materials with their other names, and the fleet", async () => {
    const { body } = await h.call<MasterResponse>("kiosk", "GET", "/api/master");
    expect(body.materials.map((material) => material.name)).toEqual(
      SEED_MATERIALS.map((material) => material.name),
    );
    expect(body.materials[0]!.aliasesHi.length).toBeGreaterThan(0);
    expect([...body.suppliers].sort()).toEqual([...SEED_SUPPLIERS].sort());
    expect([...body.transporters].sort()).toEqual([...SEED_TRANSPORTERS].sort());
  });

  it("lists an approved Type 2 truck until its first slip is printed", async () => {
    const id = await heldTruck(PLATE);
    expect(await lists()).toEqual({ ready: [], notApproved: [] });

    await storeDecides(id, "APPROVE");
    expect((await lists()).ready).toMatchObject([{ ticketId: id, plate: PLATE, slip: "FIRST" }]);

    await h.call("kiosk", "POST", `/api/tickets/${id}/printed`, { kind: "FIRST" });
    expect((await lists()).ready).toEqual([]);
  });

  it("lists a final slip the store officer allowed, until it is printed", async () => {
    const id = await heldTruck(PLATE);
    await storeDecides(id, "APPROVE");
    await h.call("kiosk", "POST", `/api/tickets/${id}/printed`, { kind: "FIRST" });
    // 1,500 kg on the invoice, but only 1,400 kg came off: on hold.
    await h.settle(18_350);
    const weighed = await h.call<TicketView>("kiosk", "POST", `/api/tickets/${id}/second-weight`);
    expect(weighed.body.status).toBe("HOLD_PENDING");
    expect((await lists()).ready).toEqual([]);

    const list = await h.call<StoreRequestsResponse>("store", "GET", "/api/store/requests");
    const hold = list.body.requests.find((item) => item.approval.kind === "HOLD")!;
    await h.call("store", "POST", `/api/approvals/${hold.approval.id}/decide`, {
      decision: "APPROVE",
      chosenWeight: "NET",
    });
    expect((await lists()).ready).toMatchObject([{ ticketId: id, slip: "FINAL" }]);

    await h.call("kiosk", "POST", `/api/tickets/${id}/printed`, { kind: "FINAL" });
    expect((await lists()).ready).toEqual([]);
  });

  it("shows a rejected truck for 10 minutes", async () => {
    const id = await heldTruck(OTHER_PLATE);
    await storeDecides(id, "REJECT");
    const { ready, notApproved } = await lists();
    expect(ready).toEqual([]);
    expect(notApproved).toMatchObject([{ ticketId: id, plate: OTHER_PLATE }]);
    const later = new Date(Date.now() + NOT_APPROVED_SHOWN_MS + 1000);
    expect((await kioskCollect(h.app, later)).notApproved).toEqual([]);
  });

  it("saves the language the driver switched to", async () => {
    const { body } = await h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
      plate: PLATE,
      language: "en",
      manual: true,
    });
    const url = `/api/tickets/${body.ticket.id}/details`;
    const saved = await h.call<{ ticket: TicketView }>("kiosk", "PATCH", url, { language: "hi" });
    expect(saved.body.ticket.language).toBe("hi");
  });
});
