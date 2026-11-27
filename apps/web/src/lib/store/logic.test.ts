import { TICKET_EVENTS, TICKET_STATUSES, type TicketView } from "@trinetra/shared";
import { describe, expect, it } from "vitest";
import en from "@/i18n/en.json";
import {
  canAccept,
  holdSum,
  invoiceAsRead,
  invoiceFile,
  isPdf,
  kindPill,
  matchesFilter,
  mayUploadBill,
  reasonOf,
  reasonWords,
  signed,
  STATUS_KEYS,
  truckPlace,
  waitingFor,
} from "./logic";

const MINUTE = 60_000;
const START = Date.parse("2026-11-27T10:00:00Z");
const after = (ms: number) => waitingFor(new Date(START).toISOString(), START + ms);

describe("how long a request has waited", () => {
  it("is amber after 5 minutes and red after 10", () => {
    expect(after(0)).toEqual({ minutes: 0, tone: "idle" });
    expect(after(5 * MINUTE - 1000)).toEqual({ minutes: 4, tone: "idle" });
    expect(after(5 * MINUTE)).toEqual({ minutes: 5, tone: "wait" });
    expect(after(10 * MINUTE - 1000)).toEqual({ minutes: 9, tone: "wait" });
    expect(after(10 * MINUTE)).toEqual({ minutes: 10, tone: "stop" });
  });

  it("is unknown before the browser's clock is read, and never negative", () => {
    expect(waitingFor(new Date(START).toISOString(), 0)).toBeNull();
    expect(after(-5000)).toEqual({ minutes: 0, tone: "idle" });
  });
});

describe("the filter tabs", () => {
  it("shows each kind under its own tab and under All", () => {
    expect(matchesFilter("type2", "STORE_TYPE2")).toBe(true);
    expect(matchesFilter("hold", "HOLD")).toBe(true);
    expect(matchesFilter("mismatch", "MISMATCH")).toBe(true);
    expect(matchesFilter("help", "DRIVER_HELP")).toBe(true);
    expect(matchesFilter("plate", "PLATE_WARNING")).toBe(true);
    expect(matchesFilter("all", "PLATE_WARNING")).toBe(true);
    expect(matchesFilter("hold", "STORE_TYPE2")).toBe(false);
  });

  it("tells a blocked plate from plates that differ", () => {
    const warning = (plateWarningReason: "BLOCKED_HISTORY" | "FRONT_BACK_MISMATCH") =>
      kindPill({ kind: "PLATE_WARNING", plateWarningReason }).key;
    expect(warning("BLOCKED_HISTORY")).toBe("store.kind.blocked");
    expect(warning("FRONT_BACK_MISMATCH")).toBe("store.kind.frontBack");
  });
});

const ticket = (values: Partial<TicketView> = {}): TicketView =>
  ({
    status: "HOLD_PENDING",
    firstWeightKg: 32_560,
    secondWeightKg: 18_250,
    netKg: 14_310,
    variancePct: 1.31,
    invoice: { state: "read", weightKg: 14_500 },
    photos: [],
    timeline: [],
    ...values,
  }) as unknown as TicketView;

const event = (type: string, data: Record<string, unknown>) => ({
  type,
  data,
  at: "2026-11-27T10:00:00.000Z",
  actor: "system",
  actorName: "System",
});

describe("the HOLD calculation", () => {
  it("takes the weights and the limit the backend saved", () => {
    const sum = holdSum(
      ticket({ timeline: [event("SECOND_WEIGHT_FAILED", { tolerancePct: 0.5 })] }),
    );
    expect(sum).toEqual({
      invoiceKg: 14_500,
      firstKg: 32_560,
      secondKg: 18_250,
      netKg: 14_310,
      differenceKg: -190,
      variancePct: 1.31,
      limitPct: 0.5,
    });
  });

  it("makes up no difference or limit", () => {
    const sum = holdSum(ticket({ invoice: { state: "none", weightKg: null } as never }));
    expect(sum).toMatchObject({ differenceKg: null, limitPct: null });
  });

  it("offers only a weight the backend would accept", () => {
    expect(canAccept(1)).toBe(true);
    expect(canAccept(0)).toBe(false);
    expect(canAccept(-20)).toBe(false);
    expect(canAccept(null)).toBe(false);
  });

  it("writes the sign of a difference", () => {
    const format = (kg: number) => `${kg} kg`;
    expect(signed(-190, format)).toBe("−190 kg");
    expect(signed(190, format)).toBe("+190 kg");
    expect(signed(0, format)).toBe("0 kg");
  });
});

describe("the bill", () => {
  const photo = (id: string) => ({ id, kind: "INVOICE" as const, url: id, takenAt: "" });

  it("shows what the reader took from it, and the file it read", () => {
    const read = ticket({
      photos: [photo("a"), photo("b")],
      timeline: [
        event("INVOICE_READ", {
          photoId: "a",
          invoiceNo: "INV-1",
          material: "OPC Cement",
          supplier: "",
          weightKg: 14_310,
          source: "gemini",
          model: "m",
          warnings: ["VEHICLE_MISMATCH"],
        }),
      ],
    });
    expect(invoiceAsRead(read)).toEqual({
      invoiceNo: "INV-1",
      material: "OPC Cement",
      supplier: null,
      weightKg: 14_310,
      source: "gemini",
      model: "m",
      warnings: ["VEHICLE_MISMATCH"],
    });
    expect(invoiceFile(read)?.id).toBe("a");
    // Not yet read: the newest file.
    expect(invoiceFile(ticket({ photos: [photo("a"), photo("b")] }))?.id).toBe("b");
    expect(invoiceAsRead(ticket())).toBeNull();
  });

  it("knows a PDF from its signed link", () => {
    expect(isPdf("/api/files/photos/1/a.pdf?expires=1&sig=x")).toBe(true);
    expect(isPdf("/api/files/photos/1/a.jpg?expires=1&sig=x.pdf")).toBe(false);
  });

  it("can be uploaded for a visit that is still at the invoice", () => {
    const at = (status: string, state: string) =>
      mayUploadBill(ticket({ status: status as never, invoice: { state } as never }));
    expect(at("STARTED", "none")).toBe(true);
    expect(at("STARTED", "failed")).toBe(true);
    expect(at("STARTED", "reading")).toBe(true);
    expect(at("STARTED", "read")).toBe(false);
    expect(at("STORE_PENDING", "none")).toBe(false);
    expect(mayUploadBill(undefined)).toBe(false);
  });
});

describe("where a truck is", () => {
  const place = (status: (typeof TICKET_STATUSES)[number], type = "TYPE_1") =>
    truckPlace({
      status,
      type: type as never,
      unloadingPoint: { code: "CH-003+750", name: "Bridge" },
      supervisor: "Suresh Yadav",
      pendingStoreApprovalId: null,
    });

  it("names the unloading point and the supervisor", () => {
    expect(place("SUPERVISOR_PENDING")).toMatchObject({
      key: "store.where.supervisor",
      params: { point: "CH-003+750", name: "Suresh Yadav" },
    });
    expect(place("STORE_PENDING").key).toBe("store.where.aside");
  });

  it("does not say a Type 2 or 3 truck was checked by a supervisor", () => {
    expect(place("READY_FOR_SECOND").key).toBe("store.where.readySecond");
    expect(place("READY_FOR_SECOND", "TYPE_3").key).toBe("store.where.unloadThenSecond");
  });

  it("has words for every status", () => {
    for (const status of TICKET_STATUSES) {
      expect(en).toHaveProperty([STATUS_KEYS[status]]);
      expect(en).toHaveProperty([place(status).key]);
    }
  });

  it("has words for every move on the timeline", () => {
    for (const name of TICKET_EVENTS) expect(en).toHaveProperty([`store.event.${name}`]);
  });
});

describe("reasons", () => {
  it("join the tapped reason and the typed words, and need one of them", () => {
    expect(reasonOf(null, "  ")).toBeNull();
    expect(reasonOf("Wrong material", "")).toBe("Wrong material");
    expect(reasonOf(null, " sand, not steel ")).toBe("sand, not steel");
    expect(reasonOf("Wrong material", "sand")).toBe("Wrong material: sand");
    expect(reasonOf(null, "x".repeat(400))).toHaveLength(300);
  });

  it("are shown in the reader's language; typed words stay", () => {
    const t = (key: string) => `[${key}]`;
    expect(reasonWords("Wrong material", t)).toBe("[store.reason.wrongMaterial]");
    expect(reasonWords("Wrong material: sand", t)).toBe("[store.reason.wrongMaterial]: sand");
    expect(reasonWords("Something else", t)).toBe("Something else");
    expect(reasonWords("Wrong truck", t)).toBe("[sup.reason.wrongTruck]");
  });
});
