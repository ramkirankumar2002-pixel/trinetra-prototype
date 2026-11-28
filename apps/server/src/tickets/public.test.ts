import type { LiveSummaryResponse, PublicTicketView } from "@trinetra/shared";
import { PUBLIC_TOKEN_PATTERN } from "@trinetra/shared";
import { SEED_USERS } from "@trinetra/shared/seed";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { hidePhoneNumbers, startOfDayIST } from "./public";

describe("hidden values", () => {
  it.each([
    ["call 9876543210 now", "call [number hidden] now"],
    ["+91 98765 43210", "[number hidden]"],
    ["98765-43210", "[number hidden]"],
    ["Invoice 4412 of 2026", "Invoice 4412 of 2026"],
  ])("%s", (text, expected) => {
    expect(hidePhoneNumbers(text)).toBe(expected);
  });

  it("starts the day at midnight in India", () => {
    expect(startOfDayIST(new Date("2026-11-26T18:29:00Z")).toISOString()).toBe(
      "2026-11-25T18:30:00.000Z",
    );
    expect(startOfDayIST(new Date("2026-11-26T18:31:00Z")).toISOString()).toBe(
      "2026-11-26T18:30:00.000Z",
    );
  });
});

describe.skipIf(!testDatabaseUrl)("public routes", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, started, weighed, secondWeight, pending } = flows(h);

  const open = (token: string) =>
    h.call<PublicTicketView>(null, "GET", `/api/public/tickets/${token}`);

  describe("GET /api/public/tickets/:token", () => {
    it("gives every ticket its own long random token", async () => {
      const first = await view(await started());
      const second = await view(await started({ plate: OTHER_PLATE }));
      expect(first.publicToken).toMatch(PUBLIC_TOKEN_PATTERN);
      expect(second.publicToken).toMatch(PUBLIC_TOKEN_PATTERN);
      expect(second.publicToken).not.toBe(first.publicToken);
    });

    it("shows the ticket with its token, without a login", async () => {
      const ticket = await view(await weighed());
      const response = await open(ticket.publicToken);
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toMatchObject({ ticketNo: ticket.ticketNo, plate: PLATE });
    });

    it("finds nothing by ticket number, id or a wrong token", async () => {
      const ticket = await view(await weighed());
      const other = ticket.publicToken.replace(/.$/, (last) => (last === "0" ? "1" : "0"));
      for (const guess of [
        ticket.ticketNo,
        String(ticket.id),
        other,
        ticket.publicToken.slice(0, 31),
        ticket.publicToken.toUpperCase(),
        "0".repeat(32),
        "x".repeat(90),
        "%27%20or%201=1",
      ]) {
        const response = await open(guess);
        expect(response.status, guess).toBe(404);
        expect(response.body.error?.code, guess).toBe("NOT_FOUND");
      }
    });

    it("never shows a phone number, an id, a PIN, the bill or a staff photo", async () => {
      const id = await weighed({ material: "Cement Bags" });
      const request = await pending(id, "SUPERVISOR");
      await h.call("amit", "POST", `/api/approvals/${request}/decide`, {
        decision: "REJECT",
        reason: "Driver said call 9811122233",
      });
      await h.db.execute(
        `update tickets set driver_name = 'Ravi Kumar', driver_phone = '9876500000',
         invoice_no = 'INV 9876511111' where id = ${id}`,
      );
      await h.db.execute(
        `insert into photos (ticket_id, kind, storage_path, sha256, taken_at)
         values (${id}, 'INVOICE', 'photos/test/the-bill.pdf', 'x', now()),
                (${id}, 'SUPERVISOR', 'photos/test/by-supervisor.jpg', 'x', now()),
                (${id}, 'STORE', 'photos/test/by-store.jpg', 'x', now()),
                (${id}, 'BACK_PLATE', 'photos/test/back.jpg', 'x', now()),
                (${id}, 'FRONT_PLATE', 'photos/test/older-front.jpg', 'x', now()),
                (${id}, 'FRONT_PLATE', 'photos/test/newest-front.jpg', 'x',
                 now() + interval '1 second')`,
      );

      const { body, status } = await open((await view(id)).publicToken);
      expect(status).toBe(200);
      expect(body.status).toBe("BLOCKED");

      // Only the values the page needs: a new one must be added here on purpose.
      expect(Object.keys(body).sort()).toEqual(
        [
          "createdAt",
          "finalWeightKg",
          "firstWeightKg",
          "frontPhoto",
          "invoiceNo",
          "invoiceWeightKg",
          "isDemo",
          "material",
          "netKg",
          "plate",
          "secondWeightKg",
          "status",
          "ticketNo",
          "timeline",
          "type",
          "unloadingPoint",
          "variancePct",
        ].sort(),
      );
      for (const step of body.timeline) {
        expect(Object.keys(step).sort()).toEqual(["at", "by", "kg", "manual", "reason", "step"]);
        if (step.by) expect(Object.keys(step.by).sort()).toEqual(["name", "role"]);
      }

      const text = JSON.stringify(body);
      for (const { phone } of SEED_USERS) {
        if (phone) expect(text).not.toContain(phone);
      }
      expect(text).not.toMatch(/9876500000|9811122233|9876511111|Ravi Kumar/);
      expect(text).not.toMatch(/user:\d|Id"|"id"|pin|phone|gps|storage|token/i);
      expect(text).not.toMatch(/the-bill|by-supervisor|by-store|back\.jpg|older-front/);

      const rejected = body.timeline.find((step) => step.step === "SUPERVISOR_REJECTED");
      expect(rejected).toMatchObject({
        by: { name: "Amit Kumar", role: "SUPERVISOR" },
        reason: "Driver said call [number hidden]",
      });
      // A short-lived signed link to the newest front photo.
      expect(body.frontPhoto?.url).toContain("newest-front.jpg");
      const url = new URL(body.frontPhoto!.url, "http://localhost");
      const seconds = Number(url.searchParams.get("expires")) - Date.now() / 1000;
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(300);
    });

    it("lists every step of a visit in order, as it goes on", async () => {
      const id = await weighed({ material: "Cement Bags" });
      const { publicToken } = await view(id);
      const steps = async () => (await open(publicToken)).body.timeline.map((step) => step.step);
      expect(await steps()).toEqual(["ARRIVED", "PLATE_READ", "FIRST_WEIGHT"]);

      const request = await pending(id, "SUPERVISOR");
      h.supervisorSees(PLATE);
      const form = h.form({ data: await h.jpeg(), type: "image/jpeg" });
      await h.call(
        "amit",
        "POST",
        `/api/supervisor/tickets/${id}/photo`,
        form.payload,
        form.headers,
      );
      await h.call("amit", "POST", `/api/approvals/${request}/decide`, { decision: "APPROVE" });
      await secondWeight(id);

      const { body } = await open(publicToken);
      expect(body.status).toBe("COMPLETED");
      expect(body.timeline.map((step) => step.step)).toEqual([
        "ARRIVED",
        "PLATE_READ",
        "FIRST_WEIGHT",
        "SUPERVISOR_APPROVED",
        "SECOND_WEIGHT",
        "COMPLETED",
      ]);
      expect(body.timeline[2]).toMatchObject({ kg: 32_560, by: null });
      expect(body.timeline[3]?.by).toEqual({ name: "Amit Kumar", role: "SUPERVISOR" });
    });

    it("shows the store officer's approval and the weight they accepted", async () => {
      const id = await weighed({ material: "Sand", invoiceKg: 14_500 });
      const first = await pending(id, "STORE_TYPE2");
      await h.call("store", "POST", `/api/approvals/${first}/decide`, { decision: "APPROVE" });
      await secondWeight(id);
      const hold = await pending(id, "HOLD");
      await h.call("store", "POST", `/api/approvals/${hold}/decide`, {
        decision: "APPROVE",
        chosenWeight: "INVOICE",
        reason: "Weighed again by hand",
      });

      const { body } = await open((await view(id)).publicToken);
      expect(body.timeline.map((step) => step.step)).toEqual([
        "ARRIVED",
        "PLATE_READ",
        "FIRST_WEIGHT",
        "STORE_APPROVED",
        "SECOND_WEIGHT",
        "ON_HOLD",
        "HOLD_APPROVED",
        "COMPLETED",
      ]);
      expect(body.finalWeightKg).toBe(14_500);
      expect(body.timeline.find((step) => step.step === "HOLD_APPROVED")).toMatchObject({
        kg: 14_500,
        by: { role: "STORE" },
        reason: null,
      });
    });
  });

  describe("GET /api/live/summary", () => {
    it("counts today's trucks and weights, with nothing private", async () => {
      const done = await weighed();
      await secondWeight(done);
      await weighed({ plate: OTHER_PLATE, material: "Sand", invoiceKg: 14_500 });
      const third = await started({ plate: "UP32EF9012" });
      await h.db.execute(
        `update tickets set status = 'REJECTED', closed_at = now() where id = ${third}`,
      );
      // Yesterday's does not count.
      const old = await started({ plate: "UP70GH3456" });
      await h.db.execute(
        `update tickets set created_at = now() - interval '2 days', status = 'BLOCKED',
         closed_at = now() - interval '2 days' where id = ${old}`,
      );

      const { status, body } = await h.call<LiveSummaryResponse>(null, "GET", "/api/live/summary");
      expect(status).toBe(200);
      expect(body).toEqual({
        trucksToday: 3,
        kgByMaterial: [{ material: "Bricks", kg: 14_310 }],
        pendingApprovals: 1,
        blockedOrRejected: 1,
        devicesOnline: { main: true, front: false, back: false },
      });
    });
  });
});
