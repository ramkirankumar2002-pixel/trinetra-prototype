import type { CreateTicketResponse, TicketView, UploadLinkResponse } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { ADMIN_PIN, OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("Idempotency-Key", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { started, weighed, pending } = flows(h);

  const key = (value: string) => ({ "idempotency-key": value });
  const timesLogged = async (id: number, type: string) =>
    (await h.eventTypes(id)).filter((item) => item === type).length;

  const firstWeight = (id: number, value: string) =>
    h.call<TicketView>("kiosk", "POST", `/api/tickets/${id}/first-weight`, undefined, key(value));

  it("answers a repeated first weight with the first result, weighing once", async () => {
    const id = await started();
    await h.settle(LOADED);
    const first = await firstWeight(id, "weigh-1");
    // Even with another truck on the bridge by now.
    await h.settle(EMPTY);
    const again = await firstWeight(id, "weigh-1");

    expect(first.status).toBe(200);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(again.status).toBe(200);
    expect(again.headers["idempotent-replayed"]).toBe("true");
    expect(again.body).toEqual(first.body);
    expect(again.body.firstWeightKg).toBe(LOADED);
    expect(await timesLogged(id, "FIRST_WEIGHT_SAVED")).toBe(1);
  });

  it("holds a second tap until the first is done, and gives both its answer", async () => {
    const id = await started();
    await h.settle(LOADED);
    const answers = await Promise.all([firstWeight(id, "tap"), firstWeight(id, "tap")]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    expect(answers[1]!.body).toEqual(answers[0]!.body);
    expect(await timesLogged(id, "FIRST_WEIGHT_SAVED")).toBe(1);
  });

  it("repeats a second weight without weighing again", async () => {
    const id = await weighed();
    await h.settle(EMPTY);
    const send = () =>
      h.call("kiosk", "POST", `/api/tickets/${id}/second-weight`, undefined, key("second"));
    const [first, again] = [await send(), await send()];
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(await timesLogged(id, "SECOND_WEIGHT_PASSED")).toBe(1);
  });

  it("does not remember a refused request", async () => {
    const id = await started();
    h.weigh(LOADED, { stable: false });
    expect((await firstWeight(id, "retry")).body.error?.code).toBe("NOT_STABLE");
    await h.settle(LOADED);
    expect((await firstWeight(id, "retry")).status).toBe(200);
  });

  it("repeats an approval instead of refusing it as already decided", async () => {
    const id = await weighed({ material: "Sand", invoiceKg: 14_500 });
    const request = await pending(id, "STORE_TYPE2");
    const decide = (headers: Record<string, string> = {}) =>
      h.call("store", "POST", `/api/approvals/${request}/decide`, { decision: "APPROVE" }, headers);
    const first = await decide(key("approve"));
    const again = await decide(key("approve"));
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(await timesLogged(id, "STORE_APPROVED")).toBe(1);
    // Without the key it is a new try, and refused.
    expect((await decide()).body.error?.code).toBe("ALREADY_DECIDED");
  });

  it("counts a repeated wrong material once", async () => {
    const id = await started();
    await h.db.execute(`update tickets set invoice_material = 'Sand' where id = ${id}`);
    const send = () =>
      h.call(
        "kiosk",
        "PATCH",
        `/api/tickets/${id}/details`,
        { material: "Bricks" },
        key("details"),
      );
    await send();
    await send();
    expect((await h.ticketRow(id)).mismatchAttempts).toBe(1);
  });

  it("gives back the same ticket, upload code and print log", async () => {
    const start = () =>
      h.call<CreateTicketResponse>(
        "kiosk",
        "POST",
        "/api/tickets",
        { plate: PLATE, language: "en", manual: true },
        key("start"),
      );
    const first = await start();
    const again = await start();
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body).toEqual(first.body);

    const id = first.body.ticket.id;
    const link = () =>
      h.call<UploadLinkResponse>(
        "kiosk",
        "POST",
        `/api/tickets/${id}/upload-link`,
        undefined,
        key("link"),
      );
    expect((await link()).body.code).toBe((await link()).body.code);
  });

  it("counts a repeated supervisor photo once", async () => {
    const id = await weighed({ material: "Cement Bags" });
    h.supervisorSees(PLATE);
    const body = h.form({ data: await h.jpeg(), type: "image/jpeg" });
    const send = () =>
      h.call<{ photosUsed: number }>(
        "amit",
        "POST",
        `/api/supervisor/tickets/${id}/photo`,
        body.payload,
        { ...body.headers, ...key("photo") },
      );
    await send();
    expect((await send()).body.photosUsed).toBe(1);
    expect(await timesLogged(id, "SUPERVISOR_PHOTO")).toBe(1);
  });

  it("refuses a key used for another request", async () => {
    const first = await started();
    const second = await started({ plate: OTHER_PLATE });
    await h.settle(LOADED);
    await firstWeight(first, "one-key");
    const response = await firstWeight(second, "one-key");
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");

    const help = (ticketId: number) =>
      h.call("kiosk", "POST", "/api/help", { ticketId }, key("help"));
    await help(first);
    expect((await help(second)).status).toBe(422);
  });

  it("keeps each user's keys apart, and checks the login before replaying", async () => {
    await h.call("kiosk", "POST", "/api/help", {}, key("shared"));
    const url = "/api/help";
    expect((await h.call(null, "POST", url, {}, key("shared"))).status).toBe(401);
    expect((await h.call("store", "POST", url, {}, key("shared"))).status).toBe(403);
  });

  it("works on the demo routes, after the admin PIN", async () => {
    const reset = (pin: string) =>
      h.call("kiosk", "POST", "/api/demo/reset", undefined, {
        "x-admin-pin": pin,
        ...key("reset"),
      });
    expect((await reset(ADMIN_PIN)).status).toBe(200);
    expect((await reset("000000")).status).toBe(403);
  });

  it("refuses a bad header", async () => {
    const response = await h.call("kiosk", "POST", "/api/help", {}, key("x".repeat(201)));
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("BAD_IDEMPOTENCY_KEY");
  });
});
