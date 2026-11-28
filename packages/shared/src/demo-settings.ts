// The demo settings page (/settings) and the DEMO badge.
import type { TicketType } from "./domain";
import type { DeviceId, WeighbridgeFault } from "./hardware";

/** The word typed to confirm "Reset demo data". The same in both languages. */
export const RESET_WORD = "RESET";

/** GET /api/demo/status, and the live event "demo:changed": is any replacement on? */
export interface DemoStatus {
  demo: boolean;
}

export interface UsageMeter {
  used: number;
  limit: number;
  /** True from 80% of the limit. */
  warn: boolean;
}

/** GET /api/demo/overview: what changes while the page is open. */
export interface DemoOverview {
  usage: {
    /** Lookups this month, counted by UTC date. */
    plateRecognizer: UsageMeter;
    /**
     * Requests today, counted by UTC date. Google publishes no one fixed free limit: the
     * limit here is our own early-warning figure.
     */
    gemini: UsageMeter;
  };
  /** lastSeenAt: when the real board was last heard. Null: not since the server started. */
  devices: Record<DeviceId, { online: boolean; lastSeenAt: string | null }>;
  weightSimulated: boolean;
  /** The weighbridge fault happening now, or null. */
  fault: WeighbridgeFault | null;
}

/** GET /api/demo/master-data: the seeded rules, to read only. */
export interface DemoMasterData {
  tolerancePct: number;
  materials: { name: string; type: TicketType; type2AboveKg: number | null }[];
  chainages: { code: string; location: string; supervisor: string }[];
  unloadingRules: {
    /** Null: the rule for every material without one of its own. */
    material: string | null;
    /** Null on a default rule. */
    tripFrom: number | null;
    tripTo: number | null;
    point: { code: string; name: string };
    supervisor: string;
    isDefault: boolean;
  }[];
  /** What the "Pick" switches can be set to. */
  plates: string[];
  invoices: { id: string; material: string; plate: string; weightKg: number }[];
}
