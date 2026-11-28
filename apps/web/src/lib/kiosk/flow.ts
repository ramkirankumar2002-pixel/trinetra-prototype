// Which screen the weighbridge shows (build plan section 8). The ticket's status comes
// from the backend; this only remembers where the driver is in the questions.
import type { AnprResponse, SlipKind, TicketView } from "@trinetra/shared";
import { create } from "zustand";
import { useLanguageStore } from "@/i18n/language-store";

export type Step =
  | "language"
  | "plate"
  | "invoice"
  | "material"
  | "supplier"
  | "transporter"
  | "phone"
  | "name"
  | "check"
  | "weigh1"
  | "result1"
  | "visit2"
  | "weigh2";

/** The questions of a first visit, in order. */
const ORDER: Step[] = [
  "invoice",
  "material",
  "supplier",
  "transporter",
  "phone",
  "name",
  "check",
  "weigh1",
];

export const nextStep = (step: Step): Step => ORDER[ORDER.indexOf(step) + 1] ?? "check";

// ---- Reading the number plate ----

export type PlatePhase = "reading" | "confirm" | "choose" | "keypad" | "failed";

export interface PlateState {
  phase: PlatePhase;
  /** The newest answer of POST /api/anpr. */
  result: AnprResponse | null;
  /** With "confirm": the plate the driver is asked about. */
  picked: string | null;
  typed: string;
  /** With "failed": the error code. */
  error: string | null;
  /** Goes up by one for each read asked for. */
  read: number;
  /** Photos that have arrived during this read. */
  photos: { front: string | null; back: string | null };
}

export const NEW_PLATE: PlateState = {
  phase: "reading",
  result: null,
  picked: null,
  typed: "",
  error: null,
  read: 0,
  photos: { front: null, back: null },
};

/** What follows a read. "reading" means: read again by itself. */
export function afterRead(result: AnprResponse): Pick<PlateState, "phase" | "picked"> {
  if (result.plate) return { phase: "confirm", picked: result.plate };
  if (!result.canConfirm && result.retriesLeft > 0) return { phase: "reading", picked: null };
  const front = result.front.plate;
  const back = result.back.plate;
  if (front && back && front !== back) return { phase: "choose", picked: null };
  const one = front ?? back;
  return one ? { phase: "confirm", picked: one } : { phase: "keypad", picked: null };
}

/** The driver says this is not their truck: read again while the backend allows it. */
export const afterNo = (result: AnprResponse | null): PlatePhase =>
  result && result.retriesLeft > 0 ? "reading" : "keypad";

// ---- The driver's visit ----

export interface Collect {
  ticketId: number;
  slip: Exclude<SlipKind, "REPRINT">;
}

export interface Session {
  /** Null is the Ready screen. */
  step: Step | null;
  /** Changes with every new driver, so nothing cached for the last one is used again. */
  driver: number;
  visit: 1 | 2;
  ticketId: number | null;
  /** The driver is changing one answer from the check screen. */
  fixing: boolean;
  /** Counts the QR codes the driver has asked for. */
  qrRound: number;
  /** Uploads already on the ticket when the driver asked to send another. */
  qrAfter: number | null;
  /** "No phone?": the store officer has been called, and the driver is waiting. */
  noPhone: boolean;
  /** This truck is finished with: it must leave before the kiosk wakes again. */
  served: boolean;
  /** A slip opened from the "Ready to collect" list. */
  collect: Collect | null;
  plate: PlateState;
}

const FRESH: Omit<Session, "driver" | "served"> = {
  step: null,
  visit: 1,
  ticketId: null,
  fixing: false,
  qrRound: 0,
  qrAfter: null,
  noPhone: false,
  collect: null,
  plate: NEW_PLATE,
};

interface KioskStore extends Session {
  /** A truck is on the bridge: ask for the language. */
  wake: () => void;
  goTo: (step: Step) => void;
  /**
   * The question is answered: on to the next, or back to the check screen. Ignored if the
   * kiosk has left that question, for example because the truck drove off while saving.
   */
  answered: (from: Step) => void;
  fix: (step: Step) => void;
  /** The plate is confirmed and the ticket known. */
  startTicket: (ticketId: number, visit: 1 | 2) => void;
  setPlate: (plate: Partial<PlateState>) => void;
  readAgain: () => void;
  uploadAgain: (uploadsSoFar: number) => void;
  /** True once the call has reached the backend; false shows the QR code again. */
  setNoPhone: (waiting: boolean) => void;
  /** This driver is done: back to Ready while the truck may still be on the bridge. */
  finish: () => void;
  truckLeft: () => void;
  /** The empty bridge: the next truck may wake the kiosk. */
  bridgeFree: () => void;
  startOver: () => void;
  openCollect: (collect: Collect) => void;
  closeCollect: () => void;
}

export const useKiosk = create<KioskStore>()((set, get) => {
  /** Back to Ready for a new driver, in English again. */
  const clear = (served: boolean) => {
    useLanguageStore.getState().resetKioskLanguage();
    set({ ...FRESH, served, driver: get().driver + 1 });
  };
  return {
    ...FRESH,
    driver: 0,
    served: false,
    wake: () => set({ step: "language", collect: null }),
    goTo: (step) => set({ step }),
    answered: (from) => {
      const { step, fixing } = get();
      if (step === from) set({ step: fixing ? "check" : nextStep(from), fixing: false });
    },
    fix: (step) => set({ step, fixing: true }),
    startTicket: (ticketId, visit) =>
      set({ ticketId, visit, step: visit === 2 ? "visit2" : "invoice" }),
    setPlate: (plate) => set((state) => ({ plate: { ...state.plate, ...plate } })),
    readAgain: () =>
      set((state) => ({
        plate: {
          ...state.plate,
          phase: "reading",
          picked: null,
          error: null,
          read: state.plate.read + 1,
          photos: { front: null, back: null },
        },
      })),
    uploadAgain: (uploadsSoFar) =>
      // A new round: the code, and "No phone?" to call the store officer again (the earlier
      // call was answered when their upload was read).
      set((state) => ({ qrAfter: uploadsSoFar, qrRound: state.qrRound + 1, noPhone: false })),
    setNoPhone: (noPhone) => set({ noPhone }),
    finish: () => clear(true),
    truckLeft: () => {
      // A slip being read from the list is not part of the truck that left.
      if (get().step !== null) clear(false);
      else set({ served: false });
    },
    bridgeFree: () => set({ served: false }),
    // The truck is still there: the wake rule asks for the language again.
    startOver: () => clear(false),
    openCollect: (collect) => set({ collect }),
    closeCollect: () => set({ collect: null }),
  };
});

/**
 * Call before a request, and ask the answer after it: has the kiosk moved on to another
 * driver meanwhile? Then the reply must change nothing on the screen.
 */
export function sameDriver(): () => boolean {
  const { driver } = useKiosk.getState();
  return () => useKiosk.getState().driver === driver;
}

// ---- Which screen ----

export type Screen =
  | Step
  | "ready"
  | "collect"
  /** The load cell wiring was tampered with: nothing can be weighed. */
  | "fault"
  | "position"
  | "loading"
  /** Type 2: the store officer is deciding. */
  | "waitStore"
  /** The material did not match 5 times. */
  | "mismatch"
  /** The plate was not approved earlier; the store officer must allow it. */
  | "notApprovedEarlier"
  | "rejected"
  | "blocked"
  | "hold"
  | "finalSlip"
  | "timedOut";

/** Steps that need the truck standing fully on the bridge. */
const NEEDS_POSITION: ReadonlySet<Screen> = new Set<Screen>([
  "plate",
  "invoice",
  "material",
  "supplier",
  "transporter",
  "phone",
  "name",
  "check",
  "weigh1",
  "weigh2",
]);

function screenOfTicket(step: Step, ticket: TicketView): Screen {
  switch (ticket.status) {
    case "ABANDONED":
      return "timedOut";
    case "MISMATCH_PENDING":
      return "mismatch";
    case "STORE_PENDING":
      return "waitStore";
    case "REJECTED":
      return "rejected";
    case "BLOCKED":
      return "blocked";
    case "HOLD_PENDING":
      return "hold";
    case "COMPLETED":
      return "finalSlip";
    case "STARTED":
      return ticket.plateCheck === "PENDING" ? "notApprovedEarlier" : step;
    case "READY_FOR_UNLOAD":
    case "SUPERVISOR_PENDING":
    case "READY_FOR_SECOND":
      // Just weighed (or just approved by the store): the first slip.
      if (step === "weigh1" || step === "result1") return "result1";
      if (step === "weigh2" && ticket.status === "READY_FOR_SECOND") return "weigh2";
      return "visit2";
  }
}

export function screenOf(
  session: Pick<Session, "step" | "ticketId" | "collect">,
  ticket: TicketView | undefined,
  positionBad: boolean,
  faulty = false,
): Screen {
  const { step, ticketId, collect } = session;
  // Over every screen. The driver's step is kept, and comes back when the fault is over.
  if (faulty) return "fault";
  if (step === null) return collect ? "collect" : "ready";
  if (step === "language") return "language";
  let screen: Screen = step;
  if (ticketId !== null) {
    if (!ticket || ticket.id !== ticketId) return "loading";
    screen = screenOfTicket(step, ticket);
  }
  return positionBad && NEEDS_POSITION.has(screen) ? "position" : screen;
}

/** Screens that wait for the driver, where the reminders apply. */
export const QUESTION_SCREENS: ReadonlySet<Screen> = new Set<Screen>([
  "language",
  "plate",
  "invoice",
  "material",
  "supplier",
  "transporter",
  "phone",
  "name",
  "check",
  "weigh1",
  "weigh2",
]);

const FIRST_VISIT_DOT: Partial<Record<Screen, number>> = {
  language: 1,
  plate: 2,
  invoice: 3,
  material: 4,
  supplier: 4,
  transporter: 4,
  phone: 4,
  name: 4,
  check: 5,
  weigh1: 6,
};
const SECOND_VISIT_DOT: Partial<Record<Screen, number>> = {
  language: 1,
  plate: 2,
  visit2: 3,
  weigh2: 3,
};

/** The step dots, or null where the screen is not one of the steps. */
export function stepDots(screen: Screen, visit: 1 | 2) {
  const current = (visit === 2 ? SECOND_VISIT_DOT : FIRST_VISIT_DOT)[screen];
  return current === undefined ? null : { current, total: visit === 2 ? 3 : 6 };
}
