import type { SupervisorPhotoResponse, SupervisorTicketView } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness, type Who } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("supervisor", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, started, weighed } = flows(h);

  /** A Type 1 truck, which goes to Amit Kumar. */
  const type1 = () => weighed({ material: "Cement Bags" });

  const list = (who: Who, query = "") =>
    h.call<{ tickets: SupervisorTicketView[] }>(who, "GET", `/api/supervisor/tickets${query}`);

  async function photo(
    id: number,
    options: {
      who?: Who | null;
      fields?: Record<string, string>;
      file?: { data: Buffer; type: string } | null;
    } = {},
  ) {
    const { who = "amit", fields = {} } = options;
    const file =
      options.file === undefined ? { data: await h.jpeg(), type: "image/jpeg" } : options.file;
    const body = h.form(file, fields);
    return h.call<SupervisorPhotoResponse>(
      who,
      "POST",
      `/api/supervisor/tickets/${id}/photo`,
      body.payload,
      body.headers,
    );
  }

  it("is for supervisors only", async () => {
    for (const url of ["/api/supervisor/tickets", "/api/supervisor/tickets/1/photo"]) {
      const method = url.endsWith("photo") ? "POST" : "GET";
      expect((await h.call(null, method, url)).status).toBe(401);
      expect((await h.call("kiosk", method, url)).status).toBe(403);
      expect((await h.call("store", method, url)).status).toBe(403);
    }
  });

  describe("GET /api/supervisor/tickets", () => {
    it("lists only this supervisor's Type 1 trucks", async () => {
      const id = await type1();
      await weighed({ plate: OTHER_PLATE, material: "Sand", invoiceKg: 900 });

      const mine = await list("amit");
      expect(mine.status).toBe(200);
      expect(mine.body.tickets).toMatchObject([
        {
          ticketId: id,
          plate: PLATE,
          material: "Cement Bags",
          invoiceWeightKg: 14_310,
          unloadingPoint: { code: "Plant" },
          approvalStatus: "PENDING",
          photosUsed: 0,
        },
      ]);
      expect((await list("suresh")).body.tickets).toEqual([]);
      expect((await list("amit", "?status=done")).body.tickets).toEqual([]);
    });

    it("refuses an unknown status", async () => {
      expect((await list("amit", "?status=old")).status).toBe(400);
    });
  });

  describe("POST /api/supervisor/tickets/:id/photo", () => {
    it("reads the plate and says whether it matches, with the GPS position", async () => {
      const id = await type1();
      h.supervisorSees(PLATE);
      const { status, body } = await photo(id, {
        fields: { lat: "21.25", lng: "81.63", accuracyM: "12" },
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ plateRead: PLATE, match: true, photosUsed: 1, photosLeft: 2 });
      const ticket = await view(id);
      expect(ticket.approvals).toMatchObject([
        {
          kind: "SUPERVISOR",
          status: "PENDING",
          plateRead: PLATE,
          plateMatch: true,
          photoId: body.photoId,
          gps: { lat: 21.25, lng: 81.63, accuracyM: 12 },
        },
      ]);
      expect(ticket.photos.map((item) => item.kind)).toContain("SUPERVISOR");
      expect(ticket.timeline.at(-1)).toMatchObject({
        type: "SUPERVISOR_PHOTO",
        actorName: "Amit Kumar",
      });
      expect(ticket.status).toBe("SUPERVISOR_PENDING");
    });

    it.each([OTHER_PLATE, null])("reports no match for %s", async (seen) => {
      const id = await type1();
      h.supervisorSees(seen);
      expect((await photo(id)).body).toMatchObject({ plateRead: seen, match: false });
    });

    it("allows 3 photos and no more", async () => {
      const id = await type1();
      h.supervisorSees(OTHER_PLATE);
      for (let n = 1; n <= 3; n++) expect((await photo(id)).body.photosUsed).toBe(n);
      const fourth = await photo(id);
      expect(fourth.status).toBe(409);
      expect(fourth.body.error?.code).toBe("PHOTO_LIMIT");
      expect((await list("amit")).body.tickets[0]?.photosUsed).toBe(3);
    });

    it("answers 403 for another supervisor's truck", async () => {
      const id = await type1();
      h.supervisorSees(PLATE);
      const response = await photo(id, { who: "suresh" });
      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe("NOT_YOUR_TICKET");
    });

    it("answers 409 when the truck is not waiting, and 404", async () => {
      const id = await started();
      expect((await photo(id)).status).toBe(403);
      expect((await photo(999)).status).toBe(404);
      const waiting = await weighed({ plate: OTHER_PLATE, material: "Cement Bags" });
      await h.db.execute(`update tickets set status = 'BLOCKED' where id = ${waiting}`);
      expect((await photo(waiting)).body.error?.code).toBe("WRONG_STAGE");
    });

    it.each([
      ["no file", { file: null }, 400],
      ["a PDF", { file: { data: Buffer.from("%PDF-1.7"), type: "application/pdf" } }, 415],
      ["text", { file: { data: Buffer.from("x"), type: "text/plain" } }, 415],
      ["half a position", { fields: { lat: "21" } }, 400],
      ["a position off the map", { fields: { lat: "99", lng: "0" } }, 400],
    ])("refuses %s", async (_what, options, status) => {
      const id = await type1();
      h.supervisorSees(PLATE);
      expect((await photo(id, options)).status).toBe(status);
    });
  });
});
