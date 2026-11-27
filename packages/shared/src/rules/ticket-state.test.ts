import { describe, expect, it } from "vitest";
import { CLOSED_TICKET_STATUSES, TICKET_STATUSES, type TicketStatus } from "../domain";
import {
  afterFirstWeightEvent,
  canTransition,
  firstWeightEvent,
  isClosedStatus,
  needsPlateApproval,
  secondWeightEvent,
  TICKET_EVENTS,
  transition,
  waitsForPerson,
  WrongStageError,
  type PlateCheck,
  type TicketEvent,
} from "./ticket-state";

// Written out separately from the table in the code, so a mistake there shows up here.
const ALLOWED: [TicketStatus, TicketEvent, TicketStatus][] = [
  ["STARTED", "MISMATCH_LIMIT_REACHED", "MISMATCH_PENDING"],
  ["STARTED", "FIRST_WEIGHT_SAVED", "READY_FOR_UNLOAD"],
  ["STARTED", "FIRST_WEIGHT_HELD", "STORE_PENDING"],
  ["STARTED", "PLATE_WARNING_APPROVED", "STARTED"],
  ["STARTED", "PLATE_WARNING_REJECTED", "REJECTED"],
  ["STARTED", "ABANDON", "ABANDONED"],
  ["MISMATCH_PENDING", "MISMATCH_RESOLVED", "STARTED"],
  ["MISMATCH_PENDING", "MISMATCH_REJECTED", "REJECTED"],
  ["MISMATCH_PENDING", "PLATE_WARNING_APPROVED", "MISMATCH_PENDING"],
  ["MISMATCH_PENDING", "PLATE_WARNING_REJECTED", "REJECTED"],
  ["STORE_PENDING", "STORE_APPROVED", "READY_FOR_UNLOAD"],
  ["STORE_PENDING", "STORE_REJECTED", "REJECTED"],
  ["READY_FOR_UNLOAD", "SUPERVISOR_REQUESTED", "SUPERVISOR_PENDING"],
  ["READY_FOR_UNLOAD", "SECOND_WEIGHT_ALLOWED", "READY_FOR_SECOND"],
  ["SUPERVISOR_PENDING", "SUPERVISOR_APPROVED", "READY_FOR_SECOND"],
  ["SUPERVISOR_PENDING", "SUPERVISOR_REJECTED", "BLOCKED"],
  ["READY_FOR_SECOND", "SECOND_WEIGHT_PASSED", "COMPLETED"],
  ["READY_FOR_SECOND", "SECOND_WEIGHT_FAILED", "HOLD_PENDING"],
  ["HOLD_PENDING", "HOLD_APPROVED", "COMPLETED"],
  ["HOLD_PENDING", "HOLD_REJECTED", "REJECTED"],
  // The store officer may end any visit that waits for a person.
  ["STARTED", "STORE_CANCELLED", "ABANDONED"],
  ["MISMATCH_PENDING", "STORE_CANCELLED", "ABANDONED"],
  ["STORE_PENDING", "STORE_CANCELLED", "ABANDONED"],
  ["SUPERVISOR_PENDING", "STORE_CANCELLED", "ABANDONED"],
  ["HOLD_PENDING", "STORE_CANCELLED", "ABANDONED"],
];

const cleared = { plateCheck: "NOT_NEEDED" } as const;

const isAllowed = (status: TicketStatus, event: TicketEvent) =>
  ALLOWED.some(([from, name]) => from === status && name === event);

const REFUSED = TICKET_STATUSES.flatMap((status) =>
  TICKET_EVENTS.filter((event) => !isAllowed(status, event)).map(
    (event) => [status, event] as const,
  ),
);

describe("transition", () => {
  it("covers every status and event pair exactly once", () => {
    expect(ALLOWED.length + REFUSED.length).toBe(TICKET_STATUSES.length * TICKET_EVENTS.length);
  });

  it.each(ALLOWED)("allows %s + %s -> %s", (from, event, to) => {
    expect(transition(from, event, cleared)).toBe(to);
    expect(canTransition(from, event, cleared)).toBe(true);
  });

  it.each(REFUSED)("refuses %s + %s", (from, event) => {
    // Refused even with the plate cleared.
    expect(() => transition(from, event, cleared)).toThrow(WrongStageError);
    expect(canTransition(from, event, cleared)).toBe(false);
  });

  it("gives the code WRONG_STAGE and says what was refused", () => {
    expect(() => transition("COMPLETED", "ABANDON")).toThrow(
      expect.objectContaining({
        code: "WRONG_STAGE",
        status: "COMPLETED",
        event: "ABANDON",
        message: "ABANDON is not allowed while the ticket is COMPLETED.",
      }),
    );
  });

  it("refuses an event name it does not know, including inherited ones", () => {
    for (const event of ["toString", "constructor", "NOPE"]) {
      expect(() => transition("STARTED", event as TicketEvent)).toThrow(WrongStageError);
    }
  });

  it("does not hide other errors", () => {
    expect(() => canTransition("NOT_A_STATUS" as TicketStatus, "ABANDON")).toThrow(TypeError);
  });

  it("matches the next statuses in the build plan table", () => {
    const planned: Record<TicketStatus, TicketStatus[]> = {
      STARTED: ["MISMATCH_PENDING", "STORE_PENDING", "READY_FOR_UNLOAD", "ABANDONED"],
      MISMATCH_PENDING: ["STARTED", "REJECTED"],
      STORE_PENDING: ["READY_FOR_UNLOAD", "REJECTED"],
      READY_FOR_UNLOAD: ["SUPERVISOR_PENDING", "READY_FOR_SECOND"],
      SUPERVISOR_PENDING: ["READY_FOR_SECOND", "BLOCKED"],
      READY_FOR_SECOND: ["HOLD_PENDING", "COMPLETED"],
      HOLD_PENDING: ["COMPLETED", "REJECTED"],
      COMPLETED: [],
      REJECTED: [],
      BLOCKED: [],
      ABANDONED: [],
    };
    for (const status of TICKET_STATUSES) {
      const reached = new Set(
        ALLOWED.filter(([from, event, to]) => {
          // The plate warning is the added check; it is not in the plan's table.
          return (
            from === status &&
            from !== to &&
            !event.startsWith("PLATE_WARNING") &&
            // Added later, like the plate warning.
            event !== "STORE_CANCELLED"
          );
        }).map(([, , to]) => to),
      );
      expect({ status, next: [...reached].sort() }).toEqual({
        status,
        next: [...planned[status]].sort(),
      });
    }
  });

  it("has no way out of a closed status", () => {
    for (const status of TICKET_STATUSES) {
      const stuck = TICKET_EVENTS.every((event) => !canTransition(status, event, cleared));
      expect(stuck).toBe(isClosedStatus(status));
      expect(isClosedStatus(status)).toBe(
        (CLOSED_TICKET_STATUSES as readonly string[]).includes(status),
      );
    }
  });
});

describe("blocked-plate check at the first weight", () => {
  const firstWeight = ["FIRST_WEIGHT_SAVED", "FIRST_WEIGHT_HELD"] as const;

  describe.each(firstWeight)("%s", (event) => {
    it.each(["PENDING", "REJECTED"] as PlateCheck[])("is refused while %s", (plateCheck) => {
      expect(() => transition("STARTED", event, { plateCheck })).toThrow(
        /until the store officer approves/,
      );
    });

    it("is refused if the check was forgotten", () => {
      expect(() => transition("STARTED", event)).toThrow(WrongStageError);
      expect(() => transition("STARTED", event, {})).toThrow(WrongStageError);
    });

    it.each(["NOT_NEEDED", "APPROVED"] as PlateCheck[])("is allowed when %s", (plateCheck) => {
      expect(canTransition("STARTED", event, { plateCheck })).toBe(true);
    });
  });

  it("does not hold up other moves", () => {
    expect(transition("STARTED", "ABANDON", { plateCheck: "PENDING" })).toBe("ABANDONED");
    expect(transition("STARTED", "MISMATCH_LIMIT_REACHED")).toBe("MISMATCH_PENDING");
  });
});

describe("whole journeys", () => {
  const run = (events: TicketEvent[]) =>
    events.reduce<TicketStatus>((status, event) => transition(status, event, cleared), "STARTED");

  it("Type 1 goes through the supervisor", () => {
    expect(
      run([
        firstWeightEvent("TYPE_1"),
        afterFirstWeightEvent("TYPE_1"),
        "SUPERVISOR_APPROVED",
        secondWeightEvent(true),
      ]),
    ).toBe("COMPLETED");
  });

  it("a supervisor rejection blocks the ticket", () => {
    expect(
      run([firstWeightEvent("TYPE_1"), afterFirstWeightEvent("TYPE_1"), "SUPERVISOR_REJECTED"]),
    ).toBe("BLOCKED");
  });

  it("Type 2 waits for the store officer first", () => {
    expect(run([firstWeightEvent("TYPE_2")])).toBe("STORE_PENDING");
    expect(
      run([
        firstWeightEvent("TYPE_2"),
        "STORE_APPROVED",
        afterFirstWeightEvent("TYPE_2"),
        secondWeightEvent(true),
      ]),
    ).toBe("COMPLETED");
  });

  it("Type 3 needs no person", () => {
    expect(
      run([firstWeightEvent("TYPE_3"), afterFirstWeightEvent("TYPE_3"), secondWeightEvent(true)]),
    ).toBe("COMPLETED");
  });

  it.each([
    ["HOLD_APPROVED", "COMPLETED"],
    ["HOLD_REJECTED", "REJECTED"],
  ] as const)("a HOLD ends with %s -> %s", (decision, status) => {
    expect(
      run([
        firstWeightEvent("TYPE_3"),
        afterFirstWeightEvent("TYPE_3"),
        secondWeightEvent(false),
        decision,
      ]),
    ).toBe(status);
  });

  it("a resolved mismatch continues", () => {
    expect(run(["MISMATCH_LIMIT_REACHED", "MISMATCH_RESOLVED", "FIRST_WEIGHT_SAVED"])).toBe(
      "READY_FOR_UNLOAD",
    );
  });
});

describe("needsPlateApproval", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const ago = (hours: number, extraMs = 0) => new Date(now.getTime() - hours * 3_600_000 - extraMs);

  it.each(["BLOCKED", "REJECTED"] as const)("is needed after a recent %s ticket", (status) => {
    expect(needsPlateApproval([{ status, closedAt: ago(1) }], now)).toBe(true);
  });

  it("counts exactly 24 hours, but not a moment more", () => {
    expect(needsPlateApproval([{ status: "BLOCKED", closedAt: ago(24) }], now)).toBe(true);
    expect(needsPlateApproval([{ status: "BLOCKED", closedAt: ago(24, 1) }], now)).toBe(false);
  });

  it.each(TICKET_STATUSES.filter((s) => s !== "BLOCKED" && s !== "REJECTED"))(
    "is not needed after a %s ticket",
    (status) => {
      expect(needsPlateApproval([{ status, closedAt: ago(1) }], now)).toBe(false);
    },
  );

  it("is not needed for a new plate", () => {
    expect(needsPlateApproval([], now)).toBe(false);
  });

  it("is still needed when a later ticket completed", () => {
    expect(
      needsPlateApproval(
        [
          { status: "COMPLETED", closedAt: ago(1) },
          { status: "BLOCKED", closedAt: ago(5) },
        ],
        now,
      ),
    ).toBe(true);
  });

  it.each([null, new Date("not a date")])("counts an unknown closing time (%s)", (closedAt) => {
    expect(needsPlateApproval([{ status: "REJECTED", closedAt }], now)).toBe(true);
  });

  it("counts a closing time slightly in the future (clock difference)", () => {
    expect(needsPlateApproval([{ status: "BLOCKED", closedAt: ago(-1) }], now)).toBe(true);
  });
});

describe("waiting for a person", () => {
  const help = { kind: "DRIVER_HELP", plateWarningReason: null } as const;
  const blocked = { kind: "PLATE_WARNING", plateWarningReason: "BLOCKED_HISTORY" } as const;
  const frontBack = { kind: "PLATE_WARNING", plateWarningReason: "FRONT_BACK_MISMATCH" } as const;

  it.each(["MISMATCH_PENDING", "STORE_PENDING", "SUPERVISOR_PENDING", "HOLD_PENDING"] as const)(
    "%s always waits for one",
    (status) => {
      expect(waitsForPerson(status, [])).toBe(true);
    },
  );

  it("a STARTED visit waits for one only after a help call or on a blocked plate", () => {
    expect(waitsForPerson("STARTED", [])).toBe(false);
    expect(waitsForPerson("STARTED", [frontBack])).toBe(false);
    expect(waitsForPerson("STARTED", [help])).toBe(true);
    expect(waitsForPerson("STARTED", [frontBack, blocked])).toBe(true);
  });

  it.each(["READY_FOR_UNLOAD", "READY_FOR_SECOND", ...CLOSED_TICKET_STATUSES] as const)(
    "%s does not, whatever was left open",
    (status) => {
      expect(waitsForPerson(status, [help, blocked])).toBe(false);
    },
  );
});
