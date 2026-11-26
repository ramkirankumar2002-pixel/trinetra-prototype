// Which screen the weighbridge shows, how it notices a truck, presses that must not act
// twice, and what the phone sends.
import type { AnprCameraResult, AnprResponse, TicketView } from "@trinetra/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { useLanguageStore } from "@/i18n/language-store";
import { ApiError } from "../api";
import { fitWithin, kindOf } from "../upload/prepare-file";
import {
  afterSnapshot,
  afterWeight,
  EMPTY_BRIDGE,
  EMPTY_MEANS_GONE_MS,
  type BridgeState,
} from "./bridge";
import { afterNo, afterRead, nextStep, sameDriver, screenOf, stepDots, useKiosk } from "./flow";
import { createPresses } from "./use-action";

const camera = (plate: string | null) => ({ plate }) as AnprCameraResult;
const read = (values: Partial<AnprResponse>) =>
  ({
    plate: null,
    retriesLeft: 0,
    canConfirm: true,
    front: camera(null),
    back: camera(null),
    ...values,
  }) as AnprResponse;

describe("what follows a plate read", () => {
  it("asks the driver to confirm the plate both cameras read", () => {
    expect(afterRead(read({ plate: "MH12AB1234", retriesLeft: 2 }))).toEqual({
      phase: "confirm",
      picked: "MH12AB1234",
    });
  });

  it("reads again by itself while the plates differ and retries are left", () => {
    const result = read({ retriesLeft: 2, canConfirm: false, front: camera("A1") });
    expect(afterRead(result).phase).toBe("reading");
  });

  it("then shows both, one, or the keypad", () => {
    expect(afterRead(read({ front: camera("X1"), back: camera("X2") })).phase).toBe("choose");
    expect(afterRead(read({ back: camera("X2") }))).toEqual({ phase: "confirm", picked: "X2" });
    expect(afterRead(read({})).phase).toBe("keypad");
  });

  it("after “No”, reads again or offers the keypad", () => {
    expect(afterNo(read({ retriesLeft: 1 }))).toBe("reading");
    expect(afterNo(read({ retriesLeft: 0 }))).toBe("keypad");
  });
});

const ticket = (values: Partial<TicketView>) =>
  ({ id: 5, status: "STARTED", plateCheck: "NOT_NEEDED", ...values }) as TicketView;

describe("the screen shown", () => {
  const at = (step: Parameters<typeof screenOf>[0]["step"], ticketId: number | null = 5) => ({
    step,
    ticketId,
    collect: null,
  });

  it("is Ready, or a collected slip, while no truck is being served", () => {
    expect(screenOf(at(null, null), undefined, true)).toBe("ready");
    expect(
      screenOf({ ...at(null, null), collect: { ticketId: 1, slip: "FIRST" } }, undefined, false),
    ).toBe("collect");
  });

  it("waits for the ticket, and ignores another truck's", () => {
    expect(screenOf(at("material"), undefined, false)).toBe("loading");
    expect(screenOf(at("material"), ticket({ id: 4 }), false)).toBe("loading");
  });

  it.each([
    ["ABANDONED", "timedOut"],
    ["MISMATCH_PENDING", "mismatch"],
    ["STORE_PENDING", "waitStore"],
    ["REJECTED", "rejected"],
    ["BLOCKED", "blocked"],
    ["HOLD_PENDING", "hold"],
    ["COMPLETED", "finalSlip"],
  ] as const)("follows the ticket's status %s", (status, screen) => {
    expect(screenOf(at("weigh1"), ticket({ status }), false)).toBe(screen);
  });

  it("stops a blocked plate until the store officer allows it", () => {
    expect(screenOf(at("invoice"), ticket({ plateCheck: "PENDING" }), false)).toBe(
      "notApprovedEarlier",
    );
    expect(screenOf(at("invoice"), ticket({ plateCheck: "APPROVED" }), false)).toBe("invoice");
  });

  it("shows the first slip after the first weight, and Welcome back on a second visit", () => {
    for (const status of ["SUPERVISOR_PENDING", "READY_FOR_SECOND"] as const) {
      expect(screenOf(at("weigh1"), ticket({ status }), false)).toBe("result1");
      expect(screenOf(at("visit2"), ticket({ status }), false)).toBe("visit2");
    }
    expect(screenOf(at("weigh2"), ticket({ status: "READY_FOR_SECOND" }), false)).toBe("weigh2");
    expect(screenOf(at("weigh2"), ticket({ status: "SUPERVISOR_PENDING" }), false)).toBe("visit2");
  });

  it("shows the position screen only where the truck must stand on the bridge", () => {
    expect(screenOf(at("plate", null), undefined, true)).toBe("position");
    expect(screenOf(at("weigh1"), ticket({}), true)).toBe("position");
    expect(screenOf(at("language", null), undefined, true)).toBe("language");
    expect(screenOf(at("weigh1"), ticket({ status: "STORE_PENDING" }), true)).toBe("waitStore");
    expect(screenOf(at("visit2"), ticket({ status: "SUPERVISOR_PENDING" }), true)).toBe("visit2");
  });

  it("has six step dots on a first visit and three on a second", () => {
    expect(stepDots("supplier", 1)).toEqual({ current: 4, total: 6 });
    expect(stepDots("weigh2", 2)).toEqual({ current: 3, total: 3 });
    expect(stepDots("ready", 1)).toBeNull();
    expect(stepDots("finalSlip", 2)).toBeNull();
  });
});

describe("the driver's visit", () => {
  beforeEach(() => {
    useKiosk.getState().startOver();
    useKiosk.setState({ served: false });
  });
  const kiosk = () => useKiosk.getState();

  it("goes through the questions in order", () => {
    expect(["invoice", "material", "name", "check"].map((s) => nextStep(s as never))).toEqual([
      "material",
      "supplier",
      "check",
      "weigh1",
    ]);
  });

  it("comes back to the check screen after fixing one answer", () => {
    kiosk().fix("supplier");
    kiosk().answered("supplier");
    expect(kiosk()).toMatchObject({ step: "check", fixing: false });
  });

  it("ignores an answer that is saved after the truck has left", () => {
    kiosk().wake();
    kiosk().startTicket(5, 1);
    const stillHere = sameDriver();
    expect(stillHere()).toBe(true);
    kiosk().truckLeft();
    kiosk().answered("invoice");
    expect(kiosk().step).toBeNull();
    expect(stillHere()).toBe(false);
  });

  it("goes back to Ready in English when the truck leaves", () => {
    useLanguageStore.getState().setLanguage("kiosk", "hi");
    kiosk().wake();
    kiosk().startTicket(5, 1);
    const driver = kiosk().driver;
    kiosk().truckLeft();
    expect(kiosk()).toMatchObject({ step: null, ticketId: null, served: false });
    expect(kiosk().driver).toBe(driver + 1);
    expect(useLanguageStore.getState().kiosk).toBe("en");
  });

  it("does not wake again for a truck it has finished with", () => {
    kiosk().wake();
    kiosk().finish();
    expect(kiosk()).toMatchObject({ step: null, served: true });
    kiosk().truckLeft();
    expect(kiosk().served).toBe(false);
  });

  it("keeps a slip opened from the list when a truck drives off", () => {
    kiosk().openCollect({ ticketId: 3, slip: "FINAL" });
    kiosk().truckLeft();
    expect(kiosk().collect).toEqual({ ticketId: 3, slip: "FINAL" });
  });

  it("forgets the photos of the last read", () => {
    kiosk().setPlate({ photos: { front: "a", back: "b" }, phase: "confirm" });
    kiosk().readAgain();
    expect(kiosk().plate).toMatchObject({
      phase: "reading",
      photos: { front: null, back: null },
    });
  });
});

describe("noticing the truck", () => {
  const present: BridgeState = { ...EMPTY_BRIDGE, truckPresent: true };
  const reading = (reason: "NOT_STABLE" | "POSITION_NOT_OK" | "NO_TRUCK" | "STALE_READING") => ({
    kg: reason === "NO_TRUCK" ? 0 : 20_000,
    canCapture: false,
    reason,
  });

  it("sees a truck from any weight above the threshold, also in a bad position", () => {
    for (const reason of ["NOT_STABLE", "POSITION_NOT_OK"] as const) {
      expect(afterWeight(EMPTY_BRIDGE, reading(reason), 0).truckPresent).toBe(true);
    }
  });

  it("counts a bridge that stays empty as a truck that left, once", () => {
    let state = { ...present, ...afterWeight(present, reading("NO_TRUCK"), 1000) };
    expect(state).toMatchObject({ truckPresent: true, departures: 0 });
    state = {
      ...state,
      ...afterWeight(state, reading("NO_TRUCK"), 1000 + EMPTY_MEANS_GONE_MS),
    };
    expect(state).toMatchObject({ truckPresent: false, departures: 1 });
    state = { ...state, ...afterWeight(state, reading("NO_TRUCK"), 99_000) };
    expect(state.departures).toBe(1);
  });

  it("does not guess while the weighbridge is silent", () => {
    expect(afterWeight(present, reading("STALE_READING"), 0).truckPresent).toBeUndefined();
  });

  it("takes the state from the backend after a lost connection", () => {
    const snapshot = {
      weight: { kg: 0, stable: true, positionOk: true, ageMs: 10 },
      devices: { main: { online: true }, front: { online: false }, back: { online: true } },
      canCapture: { ok: false as const, reason: "NO_TRUCK" as const },
    };
    expect(afterSnapshot(present, snapshot)).toMatchObject({
      truckPresent: false,
      departures: 1,
      devices: { main: true, front: false, back: true },
    });
  });
});

describe("one press, once", () => {
  function setup() {
    let number = 0;
    return createPresses(() => `key-${++number}`);
  }
  const lost = () => Promise.reject(new ApiError(0, "NETWORK_ERROR", "lost"));
  const refused = () => Promise.reject(new ApiError(409, "NOT_STABLE", "no"));

  it("sends the same key again after a lost answer, and a new one otherwise", async () => {
    const press = setup();
    const keys: string[] = [];
    const work = (fail: () => Promise<never>) => (key: string) => {
      keys.push(key);
      return fail();
    };
    await press("weigh", work(lost));
    await press("weigh", work(refused));
    await press("weigh", async (key) => void keys.push(key));
    await press("weigh", async (key) => void keys.push(key));
    expect(keys).toEqual(["key-1", "key-1", "key-2", "key-3"]);
  });

  it("ignores a second press while the first is running", async () => {
    const press = setup();
    let finish!: () => void;
    const first = press("a", () => new Promise<void>((resolve) => (finish = resolve)));
    expect(await press("b", async () => {})).toBeNull();
    finish();
    expect(await first).toMatchObject({ ok: true });
    expect(await press("b", async () => 1)).toEqual({ ok: true, data: 1 });
  });
});

describe("what the phone sends", () => {
  it("shrinks a photo to 1600 px on its longer side, and never enlarges it", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10_000, 2)).toEqual({ width: 1600, height: 1 });
  });

  it("knows a PDF and a photo, an iPhone's too, even without a type", () => {
    expect(kindOf({ type: "application/pdf", name: "a" })).toBe("pdf");
    expect(kindOf({ type: "", name: "Invoice.PDF" })).toBe("pdf");
    expect(kindOf({ type: "image/heic", name: "IMG_1.HEIC" })).toBe("photo");
    expect(kindOf({ type: "", name: "IMG_1.heic" })).toBe("photo");
    expect(kindOf({ type: "text/plain", name: "a.txt" })).toBe("other");
  });
});
