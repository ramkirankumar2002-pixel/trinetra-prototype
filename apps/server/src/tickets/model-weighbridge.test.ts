// The model weighbridge from end to end: grams become kilograms with the scale set on
// /settings, and tampering with the load cells stops every weighing.
import type { DemoOverview, DemoSettings, TamperReason, TicketView } from "@trinetra/shared";
import { SEED_SETTINGS } from "@trinetra/shared/seed";
import { describe, expect, it } from "vitest";
import { connectLive, socketToken, type LiveClient } from "../test/live-client";
import { waitFor } from "../test/device-client";
import { testDatabaseUrl } from "../test/env";
import { flows, LOADED } from "../test/flows";
import { useTicketHarness } from "../test/ticket-harness";

describe.skipIf(!testDatabaseUrl)("the model weighbridge", { timeout: 30_000 }, () => {
  const h = useTicketHarness();
  const { post, started, weighed, view, secondWeight } = flows(h);

  /** The harness gives the app fixed settings; these tests need the real ones. */
  const withDatabaseSettings = () => h.restart(undefined, true);
  const grams = (g: number) =>
    h.app.hardware.listener.mainMessage({ t: "w", g, stable: true, pos: "ok" });
  const change = (body: Partial<DemoSettings>) =>
    h.call<DemoSettings>("store", "PUT", "/api/demo/settings", body);

  describe("grams to kilograms", () => {
    it("uses 100 kg to a gram, from the seeded settings", async () => {
      await withDatabaseSettings();
      expect(SEED_SETTINGS.model_scale_kg_per_g).toBe(100);

      grams(200);
      expect(h.app.hardware.state.currentReading()!.kg).toBe(20_000);
      grams(180.04);
      expect(h.app.hardware.state.currentReading()!.kg).toBe(18_004);
    });

    it("uses a new scale at once, and the thresholds move with it", async () => {
      await withDatabaseSettings();

      const changed = await change({ modelScaleKgPerG: 40 });

      expect(changed.body).toMatchObject({ modelScaleKgPerG: 40, stableBandG: 15 });
      grams(500);
      expect(h.app.hardware.state.currentReading()!.kg).toBe(20_000);
      // 100 g, the wake threshold, is now 4,000 kg.
      grams(99);
      expect(h.app.hardware.state.truckCheck().reason).toBe("NO_TRUCK");
      grams(101);
      expect(h.app.hardware.state.truckCheck().ok).toBe(true);
    });

    it.each([0, -5, 1001, 0.001])("refuses a scale of %s", async (modelScaleKgPerG) => {
      await withDatabaseSettings();
      expect((await change({ modelScaleKgPerG })).status).toBe(400);
    });

    it.each([0, 101, 2.5])("refuses a stable band of %s g", async (stableBandG) => {
      await withDatabaseSettings();
      expect((await change({ stableBandG })).status).toBe(400);
    });

    it("will not change the scale with a truck on the bridge", async () => {
      await withDatabaseSettings();
      grams(300);

      const refused = await change({ modelScaleKgPerG: 50 });

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("BRIDGE_NOT_EMPTY");
      // Saving the same scale again changes nothing, so it is allowed.
      expect((await change({ modelScaleKgPerG: 100 })).status).toBe(200);
      expect((await change({ stableBandG: 20 })).status).toBe(200);
    });

    it("will not change the scale between the two weighings of a truck", async () => {
      await weighed({ invoiceKg: 14_310 });

      const refused = await h.call<DemoSettings>("store", "PUT", "/api/demo/settings", {
        modelScaleKgPerG: 50,
      });

      // The bridge still has the truck; once it has left, the open ticket still refuses.
      h.leave();
      await waitFor(() => h.app.hardware.state.truckCheck().reason === "NO_TRUCK");
      const later = await h.call("store", "PUT", "/api/demo/settings", { modelScaleKgPerG: 50 });
      expect(refused.status).toBe(409);
      expect(later.body.error?.code).toBe("SCALE_IN_USE");
    });

    it("keeps the scale of each weight on the timeline", async () => {
      const id = await weighed({ invoiceKg: 14_310 });
      const saved = (await view(id)).timeline.find((entry) => entry.data.modelScaleKgPerG);
      expect(saved!.data).toMatchObject({ source: "esp32", modelScaleKgPerG: 100 });
    });
  });

  describe("tampering", () => {
    const tamper = (reason: TamperReason) =>
      h.app.hardware.listener.mainMessage({ t: "tamper", reason });
    const cleared = () => h.app.hardware.listener.mainMessage({ t: "tamper_clear" });
    const timeline = async (id: number) =>
      (await view(id)).timeline.filter((entry) => entry.type.startsWith("WEIGHBRIDGE_FAULT"));

    it("blocks the first weight", async () => {
      const id = await started();
      await h.settle(LOADED);
      tamper("CELL WIRE OPEN");

      const refused = await post(id, "first-weight");

      expect(refused.status).toBe(409);
      expect(refused.body.error?.code).toBe("WEIGHBRIDGE_FAULT");
      expect((await h.ticketRow(id)).firstWeightKg).toBeNull();
    });

    it("blocks the second weight and the plate reading", async () => {
      const id = await weighed({ invoiceKg: 14_310 });
      tamper("HX711 STUCK");

      expect((await post(id, "second-weight")).body.error?.code).toBe("WEIGHBRIDGE_FAULT");
      const anpr = await h.call("kiosk", "POST", "/api/anpr");
      expect(anpr.body.error?.code).toBe("WEIGHBRIDGE_FAULT");
    });

    it("lets the truck be weighed once the wiring is healthy and the weight still", async () => {
      const id = await started();
      await h.settle(LOADED);
      tamper("HX711 NO DATA");
      cleared();

      // At once, nothing is still yet: the readings from before the fault are gone.
      expect((await post(id, "first-weight")).body.error?.code).toMatch(/NOT_STABLE|STALE_READING/);
      await h.settle(LOADED);
      expect((await post<TicketView>(id, "first-weight")).status).toBe(200);
    });

    it("writes its start and end on the timeline of the truck on the bridge", async () => {
      const id = await started();
      await h.settle(LOADED);

      tamper("CELL WIRE FAULT");
      tamper("CELL WIRE FAULT");
      cleared();
      await h.app.background.idle();

      expect(await timeline(id)).toEqual([
        expect.objectContaining({
          type: "WEIGHBRIDGE_FAULT",
          actor: "device:main",
          data: { reason: "CELL WIRE FAULT" },
        }),
        expect.objectContaining({
          type: "WEIGHBRIDGE_FAULT_CLEARED",
          data: { reason: "CELL WIRE FAULT" },
        }),
      ]);
      // The public page shows only its own named steps.
      const token = (await h.ticketRow(id)).publicToken;
      const open = await h.call(null, "GET", `/api/public/tickets/${token}`);
      expect(JSON.stringify(open.body)).not.toMatch(/FAULT|CELL WIRE/);
    });

    it("writes on no ticket when the bridge has no truck", async () => {
      const id = await weighed({ invoiceKg: 14_310 });
      h.leave();
      await waitFor(() => h.app.bridgeTicket.id === null);

      tamper("CELL WIRE OPEN");
      cleared();
      await h.app.background.idle();

      expect(await timeline(id)).toEqual([]);
      await secondWeight(id);
    });

    it("shows on the settings page while it lasts", async () => {
      tamper("CELL WIRE OPEN");
      const during = await h.call<DemoOverview>("store", "GET", "/api/demo/overview");
      cleared();
      const after = await h.call<DemoOverview>("store", "GET", "/api/demo/overview");

      expect(during.body.fault).toEqual({ reason: "CELL WIRE OPEN", since: expect.any(String) });
      expect(after.body.fault).toBeNull();
    });

    it("tells the weighbridge and the store officer, also when they connect later", async () => {
      const url = await h.app.listen({ port: 0, host: "127.0.0.1" });
      const clients: LiveClient[] = [];
      const open = async (role: "KIOSK" | "STORE" | "SUPERVISOR") => {
        const client = await connectLive(url, { token: socketToken(h.app, role, 1) });
        clients.push(client);
        return client;
      };
      const store = await open("STORE");
      const supervisor = await open("SUPERVISOR");

      tamper("CELL WIRE OPEN");
      const kiosk = await open("KIOSK");
      await waitFor(() => kiosk.named("hw:fault").length > 0);
      await waitFor(() => store.named("hw:fault").length > 1);

      const fault = { reason: "CELL WIRE OPEN", since: expect.any(String) };
      expect(store.named("hw:fault").at(-1)).toEqual({ fault });
      expect(kiosk.named("hw:fault")).toEqual([{ fault }]);
      expect(supervisor.named("hw:fault")).toEqual([]);

      cleared();
      await waitFor(() => kiosk.named("hw:fault").length > 1);
      expect(kiosk.named("hw:fault").at(-1)).toEqual({ fault: null });
      clients.forEach((client) => client.socket.close());
    });

    it("is set aside while the weight is simulated for a demo", async () => {
      tamper("HX711 NO DATA");
      h.app.hardware.simulatedWeight.set({ kg: LOADED, stable: true, pos: true });
      tamper("HX711 NO DATA");

      expect(h.app.hardware.state.fault).toBeNull();
      await waitFor(() => h.app.hardware.state.canCapture().ok);
      h.app.hardware.simulatedWeight.stop();
      // The real board repeats its alarm, and it counts again.
      tamper("HX711 NO DATA");
      expect(h.app.hardware.state.canCapture().reason).toBe("WEIGHBRIDGE_FAULT");
    });
  });
});
