import type { AnprResponse } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("POST /api/anpr", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const read = () => h.call<AnprResponse>("kiosk", "POST", "/api/anpr");

  it("is for the logged-in kiosk only", async () => {
    await h.expectRoles("POST", "/api/anpr", ["kiosk"]);
  });

  it("refuses any value from the browser, such as a weight", async () => {
    await h.settle(32_560);
    const response = await h.call("kiosk", "POST", "/api/anpr", { kg: 10 });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("needs a truck on the bridge with the position OK", async () => {
    h.cameras();
    expect((await read()).body.error?.code).toBe("DEVICE_OFFLINE");
    h.leave();
    expect((await read()).body.error?.code).toBe("NO_TRUCK");
    h.weigh(32_560, { pos: false });
    const response = await read();
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("POSITION_NOT_OK");
  });

  it("does not need the weight to be still", async () => {
    h.cameras();
    h.weigh(32_560, { stable: false });
    expect((await read()).status).toBe(200);
  });

  it("returns both plates, the match and their sources", async () => {
    h.cameras(PLATE);
    h.weigh(32_560);
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      attempt: 1,
      retriesLeft: 2,
      match: true,
      plate: PLATE,
      canConfirm: true,
      demo: false,
      openTicket: null,
      sources: { front: "plate_recognizer", back: "plate_recognizer" },
      front: { plate: PLATE },
      back: { plate: PLATE },
    });
    expect(body.front.photoUrl).toMatch(/^\/api\/files\/.+expires=/);
    expect(body.photoIds).toHaveLength(2);
  });

  it("allows 2 retries while the plates differ, then lets the driver confirm", async () => {
    h.cameras(PLATE, OTHER_PLATE);
    h.weigh(32_560);
    const answers = [await read(), await read(), await read()];
    expect(answers.map(({ body }) => [body.attempt, body.retriesLeft, body.canConfirm])).toEqual([
      [1, 2, false],
      [2, 1, false],
      [3, 0, true],
    ]);
    expect(answers[2]!.body.photoIds).toHaveLength(6);
    // No ticket yet, so nothing to warn about yet.
    expect(await h.approvalRows()).toEqual([]);
  });

  it("starts counting again when the truck leaves", async () => {
    h.cameras(PLATE, OTHER_PLATE);
    h.weigh(32_560);
    await read();
    h.leave();
    h.weigh(32_560);
    expect((await read()).body.attempt).toBe(1);
  });

  it("reports a ticket blocked in the last 24 hours, which no longer counts as open", async () => {
    await h.call("kiosk", "POST", "/api/tickets", { plate: PLATE, language: "en", manual: true });
    await h.db.execute("update tickets set status = 'BLOCKED', closed_at = now()");
    h.cameras(PLATE);
    h.weigh(32_560);
    expect((await read()).body).toMatchObject({
      openTicket: null,
      blockedTicket: { plate: PLATE, status: "BLOCKED" },
    });

    await h.db.execute("update tickets set closed_at = now() - interval '25 hours'");
    expect((await read()).body.blockedTicket).toBeNull();
  });

  it("refuses a second read while one is running", async () => {
    h.cameras();
    h.weigh(32_560);
    const statuses = await Promise.all([read(), read()]);
    expect(statuses.map((answer) => answer.status).sort()).toEqual([200, 409]);
  });
});
