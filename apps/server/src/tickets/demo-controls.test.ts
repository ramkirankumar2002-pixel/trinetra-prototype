import type {
  CreateTicketResponse,
  DemoMasterData,
  DemoOverview,
  DemoSettings,
  DemoStatus,
  TicketView,
} from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../test/env";
import { EMPTY, flows, LOADED } from "../test/flows";
import { ADMIN_PIN, OTHER_PLATE, PLATE, useTicketHarness } from "../test/ticket-harness";
import { waitFor } from "../test/device-client";
import { usageMeter } from "./demo-overview";

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

  /** The settings page's routes: the store officer, or the kiosk with the admin PIN. */
  const routes = [
    ["GET", "settings", undefined],
    ["PUT", "settings", { anprMode: "pick" }],
    ["GET", "overview", undefined],
    ["GET", "master-data", undefined],
    ["POST", "reset", undefined],
  ] as const;

  /** What the kiosk needs the admin PIN for. */
  async function kioskNeedsPin(method: "GET" | "PUT" | "POST", path: string, body?: unknown) {
    for (const pin of [null, "000000"]) {
      const response = await demo(method, path, body, pin);
      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe("WRONG_ADMIN_PIN");
    }
    expect((await demo(method, path, body)).status).toBe(200);
  }

  it.each(routes)(
    "%s /api/demo/%s is for the store officer, or the kiosk with the admin PIN",
    async (method, path, body) => {
      const url = `/api/demo/${path}`;
      expect((await h.call(null, method, url, body)).status).toBe(401);
      // A supervisor is refused, also with the right admin PIN.
      for (const headers of [{}, { "x-admin-pin": ADMIN_PIN }] as Record<string, string>[]) {
        const refused = await h.call("amit", method, url, body, headers);
        expect(refused.status).toBe(403);
        expect(refused.body.error?.code).toBe("WRONG_ROLE");
      }
      expect((await h.call("store", method, url, body)).status).toBe(200);
      await kioskNeedsPin(method, path, body);
    },
  );

  it("keeps the simulated weight from everyone but the kiosk with the admin PIN", async () => {
    const body = { kg: 100 };
    await h.expectRoles("POST", "/api/demo/weight", ["kiosk"], body);
    // The store officer decides about weights: their login cannot make one up.
    const store = await h.call("store", "POST", "/api/demo/weight", body, {
      "x-admin-pin": ADMIN_PIN,
    });
    expect(store.status).toBe(403);
    await kioskNeedsPin("POST", "weight", body);
  });

  describe("GET /api/demo/status", () => {
    const status = (who: "kiosk" | "store" | "amit" | null) =>
      h.call<DemoStatus>(who, "GET", "/api/demo/status");

    it("tells every signed-in screen, and nobody else, whether a replacement is on", async () => {
      expect((await status(null)).status).toBe(401);
      for (const who of ["kiosk", "store", "amit"] as const) {
        expect((await status(who)).body).toEqual({ demo: false });
      }
      for (const key of ["anprMode", "supervisorMode", "ocrMode"]) {
        await h.call("store", "PUT", "/api/demo/settings", { [key]: "pick" });
        expect((await status("amit")).body, key).toEqual({ demo: true });
        await h.call("store", "PUT", "/api/demo/settings", { [key]: "real" });
        expect((await status("amit")).body, key).toEqual({ demo: false });
      }
      await demo("POST", "weight", { kg: 100 });
      expect((await status("store")).body).toEqual({ demo: true });
    });
  });

  describe("switches applied at once", () => {
    const read = () => h.app.readers.readInvoice(null, PLATE);

    it("change what the very next reading does", async () => {
      const set = (body: object) => h.call("store", "PUT", "/api/demo/settings", body);
      // Real, and no file: the reader asks for one.
      await expect(read()).rejects.toMatchObject({ code: "NO_FILE" });
      await set({ ocrMode: "pick", demoInvoice: "sand" });
      await expect(read()).resolves.toMatchObject({ source: "demo" });

      await set({ supervisorMode: "pick", demoPlate: OTHER_PLATE });
      await expect(h.app.readers.readSupervisorPlate(await h.jpeg())).resolves.toMatchObject({
        source: "demo",
        plate: OTHER_PLATE,
      });
      await set({ supervisorMode: "real", ocrMode: "real" });
      await expect(read()).rejects.toMatchObject({ code: "NO_FILE" });
    });
  });

  describe("GET /api/demo/overview", () => {
    const overview = async () =>
      (await h.call<DemoOverview>("store", "GET", "/api/demo/overview")).body;

    it("counts the reading services and warns from 80%", async () => {
      expect((await overview()).usage).toEqual({
        plateRecognizer: { used: 0, limit: 2500, warn: false },
        gemini: { used: 0, limit: 200, warn: false },
      });
      const day = new Date().toISOString().slice(0, 10);
      await h.db.execute(
        `insert into settings (key, value) values ('api_usage:plate_recognizer:${day}', '1999'),
         ('api_usage:gemini:${day}', '160')`,
      );
      try {
        expect((await overview()).usage).toEqual({
          plateRecognizer: { used: 1999, limit: 2500, warn: false },
          gemini: { used: 160, limit: 200, warn: true },
        });
        expect(usageMeter(2000, 2500).warn).toBe(true);
      } finally {
        await h.db.execute("delete from settings where key like 'api_usage:%'");
      }
    });

    it("says which boards are there and when each real one was last heard", async () => {
      const before = await overview();
      expect(before.devices.front).toEqual({ online: false, lastSeenAt: null });
      expect(before.weightSimulated).toBe(false);

      h.weigh(1000);
      await waitFor(() => h.app.hardware.lastHeard("main") !== null);
      expect((await overview()).devices.main).toEqual({
        online: true,
        lastSeenAt: expect.any(String),
      });
    });

    it("does not count a simulated weight as the ESP32", async () => {
      await demo("POST", "weight", { kg: LOADED });
      const body = await overview();
      expect(body.weightSimulated).toBe(true);
      expect(body.devices.main).toEqual({ online: false, lastSeenAt: null });
    });
  });

  describe("GET /api/demo/master-data", () => {
    it("shows the seeded rules, without phone numbers or PINs", async () => {
      const { body } = await h.call<DemoMasterData>("store", "GET", "/api/demo/master-data");
      expect(body.tolerancePct).toBe(0.5);
      expect(body.materials).toContainEqual({
        name: "Sand",
        type: "TYPE_3",
        type2AboveKg: 1000,
      });
      expect(body.chainages).toHaveLength(10);
      expect(body.unloadingRules).toContainEqual({
        material: "Bitumen",
        tripFrom: 1,
        tripTo: 2,
        point: { code: "CH-003+750", name: "Bridge Approach Road" },
        supervisor: "Suresh Yadav",
        isDefault: false,
      });
      expect(body.unloadingRules.at(-1)).toMatchObject({ material: null, isDefault: true });
      expect(body.plates).toContain(PLATE);
      expect(body.invoices).toContainEqual({
        id: "cement",
        material: "Cement Bags",
        plate: PLATE,
        weightKg: 14_310,
      });
      expect(body.invoices).toContainEqual(
        expect.objectContaining({ id: "model-cement", weightKg: 20_000 }),
      );
      expect(JSON.stringify(body)).not.toMatch(/98765432\d\d|pin|hash|phone/i);
    });
  });

  it("locks after 5 wrong admin PINs", async () => {
    for (let n = 0; n < 5; n++) await demo("GET", "settings", undefined, "111111");
    expect((await demo("GET", "settings")).status).toBe(429);
  });

  describe("settings", () => {
    it("reads and changes the switches", async () => {
      expect((await demo("GET", "settings")).body).toEqual({
        anprMode: "real",
        supervisorMode: "real",
        ocrMode: "real",
        demoPlate: PLATE,
        demoInvoice: "cement",
        weightMode: "real",
        simulatedWeight: null,
        modelScaleKgPerG: 100,
        stableBandG: 15,
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
      { supervisorMode: "off" },
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

    it.each(["anprMode", "supervisorMode", "ocrMode"])(
      "tags tickets made while %s is pick",
      async (key) => {
        await demo("PUT", "settings", { [key]: "pick" });
        expect((await start()).body.ticket.isDemo).toBe(true);
      },
    );

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

    it("removes help calls made before a ticket, but not one on a real ticket", async () => {
      const callForHelp = async (body: object) => {
        expect((await h.call("kiosk", "POST", "/api/help", body)).status).toBe(200);
      };
      // One that the store officer has answered, and one still waiting.
      await callForHelp({});
      const [answered] = await h.approvalRows();
      await h.call("store", "POST", `/api/approvals/${answered!.id}/decide`, {
        decision: "APPROVE",
      });
      await callForHelp({});
      const real = await started();
      await callForHelp({ ticketId: real });
      expect((await h.approvalRows()).map((row) => row.ticketId)).toEqual([null, null, real]);

      const response = await h.call("store", "POST", "/api/demo/reset");

      expect(response.body).toEqual({ deletedTickets: 0 });
      expect(await h.approvalRows()).toMatchObject([
        { ticketId: real, kind: "DRIVER_HELP", status: "PENDING" },
      ]);
    });

    it("keeps the users and the master data, whoever resets", async () => {
      const counts = async () => {
        const result: Record<string, unknown> = {};
        for (const table of [
          "users",
          "materials",
          "chainages",
          "unloading_points",
          "unloading_rules",
          "vehicles",
          "transporters",
          "suppliers",
        ]) {
          const rows = await h.db.execute(`select * from ${table} order by id`);
          result[table] = [...rows];
        }
        return result;
      };
      await demo("PUT", "settings", { anprMode: "pick" });
      await weighed();
      const before = await counts();

      const response = await h.call("store", "POST", "/api/demo/reset");
      expect(response.body).toEqual({ deletedTickets: 1 });
      expect(await counts()).toEqual(before);
    });

    it("refuses values", async () => {
      expect((await demo("POST", "reset", { all: true })).status).toBe(400);
    });
  });
});
