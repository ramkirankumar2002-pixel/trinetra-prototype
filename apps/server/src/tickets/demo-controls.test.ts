import type { CreateTicketResponse, DemoSettings, TicketView } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { ADMIN_PIN, OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { waitFor } from "../test/device-client";

describe.skipIf(!testDatabaseUrl)("demo controls", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { view, post, started, weighed, secondWeight } = flows(h);

  const demo = <T = DemoSettings>(
    method: "GET" | "PUT" | "POST",
    path: string,
    body?: unknown,
    pin: string | null = ADMIN_PIN,
  ) =>
    h.call<T>(
      "kiosk",
      method,
      `/api/demo/${path}`,
      body,
      pin === null ? {} : { "x-admin-pin": pin },
    );

  const routes = [
    ["GET", "settings", undefined],
    ["PUT", "settings", { anprMode: "pick" }],
    ["POST", "weight", { kg: 100 }],
    ["POST", "reset", undefined],
  ] as const;

  it.each(routes)(
    "%s /api/demo/%s needs the kiosk and the admin PIN",
    async (method, path, body) => {
      await h.expectRoles(method, `/api/demo/${path}`, ["kiosk"], body);
      for (const pin of [null, "000000"]) {
        const response = await demo(method, path, body, pin);
        expect(response.status).toBe(403);
        expect(response.body.error?.code).toBe("WRONG_ADMIN_PIN");
      }
      expect((await demo(method, path, body)).status).toBe(200);
    },
  );

  it("locks after 5 wrong admin PINs", async () => {
    for (let n = 0; n < 5; n++) await demo("GET", "settings", undefined, "111111");
    expect((await demo("GET", "settings")).status).toBe(429);
  });

  describe("settings", () => {
    it("reads and changes the switches", async () => {
      expect((await demo("GET", "settings")).body).toEqual({
        anprMode: "real",
        ocrMode: "real",
        demoPlate: PLATE,
        demoInvoice: "cement",
        weightMode: "real",
        simulatedWeight: null,
      });
      const changed = await demo("PUT", "settings", {
        anprMode: "pick",
        ocrMode: "pick",
        demoPlate: "mh 14 cd 5678",
        demoInvoice: "sand",
      });
      expect(changed.body).toMatchObject({
        anprMode: "pick",
        ocrMode: "pick",
        demoPlate: OTHER_PLATE,
        demoInvoice: "sand",
      });
    });

    it.each([
      { anprMode: "fake" },
      { demoPlate: "KA01AA0001" },
      { demoInvoice: "gold" },
      { weightMode: "simulated" },
      { tolerance: 100 },
    ])("refuses %o", async (body) => {
      expect((await demo("PUT", "settings", body)).status).toBe(400);
    });
  });

  describe("simulated weight", () => {
    const simulate = async (kg: number) => {
      expect((await demo("POST", "weight", { kg })).status).toBe(200);
      await waitFor(() => h.app.hardware.state.canCapture().ok, 5000);
    };

    it.each([{ kg: -1 }, { kg: 1.5 }, { kg: 300_000 }, {}])("refuses %o", async (body) => {
      expect((await demo("POST", "weight", body)).status).toBe(400);
    });

    it("weighs with no ESP32, tags the ticket demo and says where the weight came from", async () => {
      const id = await started();
      await simulate(LOADED);
      const { status, body } = await post(id, "first-weight");

      expect(status).toBe(200);
      expect(body).toMatchObject({ firstWeightKg: LOADED, isDemo: true });
      expect(body.timeline.find((e) => e.type === "FIRST_WEIGHT_SAVED")?.data).toMatchObject({
        source: "simulated",
      });
    });

    it("sets the ESP32's readings aside, and gives the weight back to it", async () => {
      await demo("POST", "weight", { kg: LOADED });
      // The ESP32 keeps sending.
      h.weigh(1234);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(h.app.hardware.state.currentReading()?.kg).toBe(LOADED);

      const back = await demo("PUT", "settings", { weightMode: "real" });
      expect(back.body.weightMode).toBe("real");
      await waitFor(() => h.app.hardware.state.currentReading()?.kg === 1234);
    });

    it("is gone after a restart", async () => {
      await demo("POST", "weight", { kg: LOADED });
      await h.restart();
      expect((await demo("GET", "settings")).body.weightMode).toBe("real");
    });
  });

  describe("tagging demo tickets", () => {
    const start = () =>
      h.call<CreateTicketResponse>("kiosk", "POST", "/api/tickets", {
        plate: PLATE,
        language: "en",
        manual: true,
      });

    it.each(["anprMode", "ocrMode"])("tags tickets made while %s is pick", async (key) => {
      await demo("PUT", "settings", { [key]: "pick" });
      expect((await start()).body.ticket.isDemo).toBe(true);
    });

    it("leaves tickets alone with every switch on real", async () => {
      expect((await start()).body.ticket.isDemo).toBe(false);
    });
  });

  describe("reset", () => {
    it("deletes demo tickets only and starts the trips again", async () => {
      const real = await weighed({ plate: OTHER_PLATE, material: "Sand", invoiceKg: 900 });
      await demo("PUT", "settings", { anprMode: "pick" });
      const fake = await weighed({ material: "Sand", invoiceKg: 900 });
      expect((await view(fake)).tripNo).toBe(2);
      await secondWeight(fake, EMPTY);
      await h.call("kiosk", "POST", "/api/help", { ticketId: fake });
      await h.call("kiosk", "POST", "/api/tickets", {
        plate: "UP32EF9012",
        language: "en",
        manual: true,
      });
      await demo("PUT", "settings", { anprMode: "real" });

      const response = await demo<{ deletedTickets: number }>("POST", "reset");
      expect(response.body).toEqual({ deletedTickets: 2 });
      expect((await h.allTickets()).map((ticket) => ticket.id)).toEqual([real]);
      expect((await h.eventTypes(real)).length).toBeGreaterThan(0);
      expect(await h.eventTypes(fake)).toEqual([]);
      expect(await h.approvalRows()).toEqual([]);

      const next = await weighed({ material: "Sand", invoiceKg: 900 });
      const after = (await h.call<TicketView>("kiosk", "GET", `/api/tickets/${next}`)).body;
      expect(after.tripNo).toBe(1);
      // A ticket number is never used twice, even after a reset.
      expect(after.ticketNo.endsWith("-0004")).toBe(true);
    });

    it("refuses values", async () => {
      expect((await demo("POST", "reset", { all: true })).status).toBe(400);
    });
  });
});
