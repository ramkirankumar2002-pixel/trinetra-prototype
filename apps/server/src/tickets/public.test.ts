import type { LiveSummaryResponse, PublicTicketView } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { hidePhoneNumbers, publicData, startOfDayIST } from "./public";

describe("hidden values", () => {
  it.each([
    ["call 9876543210 now", "call [number hidden] now"],
    ["+91 98765 43210", "[number hidden]"],
    ["98765-43210", "[number hidden]"],
    ["Invoice 4412 of 2026", "Invoice 4412 of 2026"],
  ])("%s", (text, expected) => {
    expect(hidePhoneNumbers(text)).toBe(expected);
  });

  it("keeps only the timeline values that are allowed", () => {
    expect(
      publicData({
        kg: 5,
        gps: { lat: 1 },
        photoId: "x",
        approvalId: 2,
        driverPhone: "9876543210",
        note: "ring 9876543210",
        anpr: { front: "A", photoIds: ["y"] },
      }),
    ).toEqual({ kg: 5, note: "ring [number hidden]", front: "A" });
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

  describe("GET /api/public/tickets/:ticketNo", () => {
    it("shows the timeline without a login, and no phone numbers or driver", async () => {
      const id = await weighed({ material: "Cement Bags" });
      const request = await pending(id, "SUPERVISOR");
      await h.call("amit", "POST", `/api/approvals/${request}/decide`, {
        decision: "REJECT",
        reason: "Driver said call 9811122233",
      });
      await h.db.execute(
        `update tickets set driver_name = 'Ravi Kumar', driver_phone = '9876500000' where id = ${id}`,
      );
      await h.db.execute(
        `insert into photos (ticket_id, kind, storage_path, sha256)
         values (${id}, 'INVOICE', 'photos/test/invoice.pdf', 'x'),
                (${id}, 'FRONT_PLATE', 'photos/test/front.jpg', 'x')`,
      );
      const { ticketNo } = await view(id);

      const response = await h.call<PublicTicketView>(
        null,
        "GET",
        `/api/public/tickets/${ticketNo}`,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ ticketNo, plate: PLATE, status: "BLOCKED" });
      expect(response.body.timeline.map((e) => e.type)).toContain("SUPERVISOR_REJECTED");
      expect(response.body.timeline[0]?.actorName).toBe("WB-01");

      const text = JSON.stringify(response.body);
      // The supervisor's and the driver's numbers, and the one typed in a reason.
      expect(text).not.toMatch(/98765432\d\d|9876500000|9811122233/);
      expect(text).not.toMatch(/Ravi Kumar|Phone|gps|photoId|storage/);

      expect(response.body.photos.map((p) => p.kind)).toEqual(["FRONT_PLATE"]);
      // A short-lived signed link.
      const url = new URL(response.body.photos[0]!.url, "http://localhost");
      const seconds = Number(url.searchParams.get("expires")) - Date.now() / 1000;
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(300);
    });

    it.each(["WB01-20261126-9999", "1", "x"])("answers 404 for %s", async (ticketNo) => {
      expect((await h.call(null, "GET", `/api/public/tickets/${ticketNo}`)).status).toBe(404);
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
