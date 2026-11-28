// @vitest-environment jsdom
// What the weighbridge does after a weight (it stays while the truck is there, then goes
// back to Ready), and the new first questions: loaded or empty, and no invoice.
import type { TicketView } from "@trinetra/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { needsLoadQuestion, screenOf, stepDots, useKiosk } from "@/lib/kiosk/flow";
import { useReturnAfter } from "@/lib/kiosk/idle";
import { savedAnswers, kindPill, decisionWords } from "@/lib/store/logic";
import { appHeaders } from "@/lib/areas";
import { BACK_TO_READY_MS } from "./screens/results";
import { slipFields } from "./slip-fields";

const t = (key: string) => key;
const ticket = (values: Partial<TicketView> = {}): TicketView =>
  ({
    id: 7,
    plate: "MH12AB1234",
    status: "STARTED",
    load: "LOADED",
    noInvoice: false,
    plateCheck: "NOT_NEEDED",
    material: null,
    mismatchAttempts: 0,
    timeline: [],
    approvals: [],
    invoice: { number: null, material: null, date: null, weightKg: null, state: "none" },
    firstWeightAt: "2026-11-28T08:00:00.000Z",
    firstWeightKg: 12_500,
    secondWeightKg: null,
    netKg: null,
    finalWeightKg: null,
    variancePct: null,
    ...values,
  }) as TicketView;

beforeEach(() => {
  vi.useFakeTimers();
  useKiosk.getState().startOver();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("loaded or empty", () => {
  it("is asked of a new visit", () => {
    expect(needsLoadQuestion(ticket())).toBe(true);
    useKiosk.getState().startTicket(7, 1);
    expect(useKiosk.getState().step).toBe("load");
  });

  it.each([
    ["a material", { material: "Sand" }],
    ["No invoice", { noInvoice: true }],
    ["a mismatch", { mismatchAttempts: 1 }],
    ["a bill sent", { timeline: [{ type: "INVOICE_RECEIVED" }] as TicketView["timeline"] }],
  ])("is not asked again of a visit that already has %s", (_what, given) => {
    expect(needsLoadQuestion(ticket(given))).toBe(false);
  });

  it("is not asked of a truck back for its second weight: that comes at once", () => {
    useKiosk.getState().startTicket(7, 2);
    expect(useKiosk.getState().step).toBe("visit2");
    const open = ticket({ status: "READY_FOR_SECOND" });
    expect(screenOf(useKiosk.getState(), open, false)).toBe("visit2");
  });

  it("needs the truck standing right, and has its step dots", () => {
    for (const step of ["load", "weighEmpty"] as const) {
      expect(screenOf({ step, ticketId: 7, collect: null }, ticket(), true)).toBe("position");
    }
    expect(stepDots("load", 1)).toEqual({ current: 3, total: 6 });
    expect(stepDots("weighEmpty", 1)).toEqual({ current: 6, total: 6 });
  });

  it("shows an empty truck's own slip once weighed", () => {
    const done = ticket({ status: "COMPLETED", load: "EMPTY" });
    const session = { step: "weighEmpty" as const, ticketId: 7, collect: null };
    expect(screenOf(session, done, false)).toBe("emptySlip");
    // The position no longer matters: the truck is leaving.
    expect(screenOf(session, done, true)).toBe("emptySlip");
    expect(slipFields(done, "FINAL", t).map((field) => field.label)).toEqual([
      "slip.plate",
      "slip.emptyWeight",
    ]);
  });
});

describe("a truck without an invoice", () => {
  const held = ticket({ noInvoice: true, status: "STORE_PENDING", material: "Sand" });

  it("says so on both slips, with no invoice figures or variance", () => {
    for (const slip of ["FIRST", "FINAL"] as const) {
      const fields = slipFields({ ...held, status: "COMPLETED" }, slip, t);
      expect(fields).toContainEqual({ label: "slip.invoice", value: "slip.noInvoice", wide: true });
      const labels = fields.map((field) => field.label);
      expect(labels).not.toContain("slip.invoiceWeight");
      expect(labels).not.toContain("slip.variance");
      expect(labels).not.toContain("slip.result");
    }
  });

  it("is named so in the store officer's lists", () => {
    const request = { kind: "STORE_TYPE2" as const, plateWarningReason: null };
    expect(kindPill(request, false, true).key).toBe("store.kind.noInvoice");
    expect(kindPill(request).key).toBe("store.kind.type2");
    expect(decisionWords({ ...request, status: "APPROVED", noInvoice: true }).about).toBe(
      "store.kind.noInvoice",
    );
    expect(savedAnswers({ load: "EMPTY" })).toEqual([{ label: "store.load.empty", value: null }]);
  });
});

describe("back to Ready after a weight", () => {
  it("stays on the result while the truck is on the bridge", () => {
    const done = vi.fn();
    renderHook(() => useReturnAfter(BACK_TO_READY_MS, done, false));
    act(() => void vi.advanceTimersByTime(10 * 60_000));
    expect(done).not.toHaveBeenCalled();
  });

  it("returns 15 s after the bridge is empty", () => {
    const done = vi.fn();
    const view = renderHook(
      ({ empty }: { empty: boolean }) => useReturnAfter(BACK_TO_READY_MS, done, empty),
      { initialProps: { empty: false } },
    );
    act(() => void vi.advanceTimersByTime(60_000));
    view.rerender({ empty: true });
    act(() => void vi.advanceTimersByTime(BACK_TO_READY_MS - 1));
    expect(done).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(done).toHaveBeenCalledOnce();
    expect(BACK_TO_READY_MS).toBe(15_000);
  });

  it.each(["result1", "weigh2", "weighEmpty"] as const)(
    "is Ready at once when the truck leaves (%s)",
    (step) => {
      useKiosk.setState({ step, ticketId: 7 });
      useKiosk.getState().truckLeft();
      const session = useKiosk.getState();
      expect(screenOf(session, undefined, false)).toBe("ready");
      // The next truck wakes it.
      expect(session.served).toBe(false);
    },
  );
});

describe("which login a page asks for", () => {
  it.each([
    ["/kiosk", "kiosk"],
    ["/kiosk/login", "kiosk"],
    ["/supervisor/trucks", "supervisor"],
    ["/store/approvals/3", "store"],
    ["/settings", "store"],
  ])("%s names the %s app", (path, app) => {
    expect(appHeaders(path)).toEqual({ "x-trinetra-app": app });
  });

  it.each(["/", "/t/abc", "/u/abc", "/dev/live"])("%s names none", (path) => {
    expect(appHeaders(path)).toEqual({});
  });
});
