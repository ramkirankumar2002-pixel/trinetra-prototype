import type { SupervisorPhotoResponse, SupervisorTicketsResponse } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { flows } from "../test/flows";
import { OTHER_PLATE, PLATE, useTicketHarness, type Who } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("supervisor", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, started, weighed, pending } = flows(h);

  /** A Type 1 truck, which goes to Amit Kumar. */
  const type1 = () => weighed({ material: "Cement Bags" });

  const list = (who: Who, query = "") =>
    h.call<SupervisorTicketsResponse>(who, "GET", `/api/supervisor/tickets${query}`);

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

    it("names the supervisor's unloading points, even with no truck", async () => {
      expect((await list("suresh")).body.points).toEqual([
        { code: "CH-003+750", name: "Bridge Approach Road" },
      ]);
      expect((await list("amit")).body.points).toEqual([{ code: "Plant", name: "Plant" }]);
    });

    it("puts the truck that has waited longest first, with its trip number", async () => {
      const first = await type1();
      const second = await weighed({ plate: OTHER_PLATE, material: "Cement Bags" });
      const { tickets } = (await list("amit")).body;
      expect(tickets.map((item) => [item.ticketId, item.tripNo])).toEqual([
        [first, 1],
        [second, 2],
      ]);
    });

    it("keeps only today's decisions in the done list, newest first, with the photo", async () => {
      const first = await type1();
      const second = await weighed({ plate: OTHER_PLATE, material: "Cement Bags" });
      h.supervisorSees(PLATE);
      await photo(first);
      for (const id of [first, second]) {
        await h.call("amit", "POST", `/api/approvals/${await pending(id, "SUPERVISOR")}/decide`, {
          decision: "REJECT",
          reason: "Wrong truck",
        });
      }
      const done = async () => (await list("amit", "?status=done")).body.tickets;
      expect(await done()).toMatchObject([
        { ticketId: second, photoUrl: null, reason: "Wrong truck" },
        { ticketId: first, photoUrl: expect.stringContaining("/api/files/"), matchResult: "MATCH" },
      ]);
      await h.db.execute(
        `update approvals set decided_at = now() - interval '25 hours' where ticket_id = ${first}`,
      );
      expect((await done()).map((item) => item.ticketId)).toEqual([second]);
    });

    it("sends a Steel Bars truck to Vikram Sharma, and Amit Kumar does not see it", async () => {
      const id = await weighed({ material: "Steel Bars" });

      expect((await list("vikram")).body.tickets).toMatchObject([
        {
          ticketId: id,
          material: "Steel Bars",
          unloadingPoint: { code: "CH-010+500", name: "Middle Section Point" },
        },
      ]);
      expect((await list("amit")).body.tickets).toEqual([]);

      const request = await pending(id, "SUPERVISOR");
      const opened = await h.call("amit", "GET", `/api/tickets/${id}`);
      expect(opened.body.error?.code).toBe("NOT_YOUR_TICKET");
      h.supervisorSees(PLATE);
      expect((await photo(id, { who: "amit" })).status).toBe(403);
      const refused = await h.call("amit", "POST", `/api/approvals/${request}/decide`, {
        decision: "REJECT",
        reason: "Wrong truck",
      });
      expect(refused.status).toBe(403);

      expect((await photo(id, { who: "vikram" })).body.matchResult).toBe("MATCH");
      const approved = await h.call("vikram", "POST", `/api/approvals/${request}/decide`, {
        decision: "APPROVE",
      });
      expect(approved.status).toBe(200);
      expect((await view(id)).status).toBe("READY_FOR_SECOND");
    });

    it.each([
      [1, "suresh"],
      [3, "pankaj"],
    ])("sends Bitumen trip %i to %s", async (trips, username) => {
      let id = 0;
      for (const plate of [PLATE, OTHER_PLATE, "UP32EF9012"].slice(0, trips)) {
        id = await weighed({ plate, material: "Bitumen" });
        h.leave();
      }
      const ticket = await view(id);
      expect(ticket.tripNo).toBe(trips);
      expect(ticket.supervisor?.name.toLowerCase()).toContain(username);
    });

    it("sends Additive to the default point, Amit Kumar", async () => {
      const id = await weighed({ material: "Additive" });
      expect((await view(id)).unloadingPoint?.code).toBe("Plant");
      expect((await list("amit")).body.tickets).toMatchObject([{ ticketId: id }]);
    });

    it("answers 403 when another supervisor opens the truck", async () => {
      const id = await type1();
      const open = (who: Who) => h.call(who, "GET", `/api/tickets/${id}`);
      expect((await open("amit")).status).toBe(200);
      const other = await open("suresh");
      expect(other.status).toBe(403);
      expect(other.body.error?.code).toBe("NOT_YOUR_TICKET");
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
      expect(body).toMatchObject({
        plateRead: PLATE,
        match: true,
        matchResult: "MATCH",
        confidence: 0.9,
        photosUsed: 1,
        photosLeft: 2,
      });
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

    it.each([
      [OTHER_PLATE, "NO_MATCH"],
      ["MH12AB1235", "CLOSE"],
      [null, "NOT_READ"],
    ])("reports no match for %s: %s", async (seen, matchResult) => {
      const id = await type1();
      h.supervisorSees(seen);
      expect((await photo(id)).body).toMatchObject({ plateRead: seen, match: false, matchResult });
    });

    it.each(["camera", "fallback"])("saves how the photo was taken: %s", async (captureSource) => {
      const id = await type1();
      h.supervisorSees(PLATE);
      await photo(id, { fields: { captureSource } });
      const ticket = await view(id);
      expect(ticket.approvals[0]).toMatchObject({
        captureSource,
        matchResult: "MATCH",
        plateConfidence: 0.9,
      });
      expect(ticket.timeline.at(-1)?.data).toMatchObject({ captureSource, matchResult: "MATCH" });
    });

    it("keeps one photo when the same upload is sent twice", async () => {
      const id = await type1();
      h.supervisorSees(PLATE);
      const body = h.form({ data: await h.jpeg(), type: "image/jpeg" });
      const send = () =>
        h.call<SupervisorPhotoResponse>(
          "amit",
          "POST",
          `/api/supervisor/tickets/${id}/photo`,
          body.payload,
          { ...body.headers, "idempotency-key": "one-upload" },
        );
      const first = await send();
      const again = await send();
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect((await list("amit")).body.tickets[0]?.photosUsed).toBe(1);
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
      ["an unknown capture source", { fields: { captureSource: "gallery" } }, 400],
      ["a position off the map", { fields: { lat: "99", lng: "0" } }, 400],
    ])("refuses %s", async (_what, options, status) => {
      const id = await type1();
      h.supervisorSees(PLATE);
      expect((await photo(id, options)).status).toBe(status);
    });
  });

  it("says when a photo's reading came from demo mode, not from the photo", async () => {
    const id = await flows(h).weighed({ material: "Cement Bags" });
    const demoReading = async () =>
      (
        await h.call<{ tickets: { demoReading: boolean }[] }>(
          "amit",
          "GET",
          "/api/supervisor/tickets?status=pending",
        )
      ).body.tickets[0]!.demoReading;
    const photograph = async (source: "demo" | "plate_recognizer") => {
      h.app.readers.readSupervisorPlate = async () => ({
        plate: PLATE,
        source,
        model: null,
        confidence: null,
        validFormat: true,
        ms: 1,
        problems: [],
      });
      const body = h.form({ data: await h.jpeg(), type: "image/jpeg" });
      const url = `/api/supervisor/tickets/${id}/photo`;
      expect((await h.call("amit", "POST", url, body.payload, body.headers)).status).toBe(200);
    };

    expect(await demoReading()).toBe(false);
    await photograph("demo");
    expect(await demoReading()).toBe(true);
    // A later real reading replaces it.
    await photograph("plate_recognizer");
    expect(await demoReading()).toBe(false);
  });
});
