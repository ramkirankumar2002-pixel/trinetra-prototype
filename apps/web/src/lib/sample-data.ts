// MADE-UP DATA for the dashboard homes, until Phases 12 and 13 load real trucks and
// requests. Every card that shows it carries the "Sample" mark. The plates start with
// "XX" and the tickets with "SAMPLE", so none can be taken for real. Delete this file
// when the real lists arrive.
import type { MessageKey } from "@/i18n/translate";
import type { Tone } from "@/components/ui/tone";

export interface SampleTruck {
  ticket: string;
  plate: string;
  material: string;
  waitingMin: number | null;
  status: { tone: Tone; label: MessageKey };
  /** May be verified now. */
  toVerify: boolean;
}

export const SAMPLE_TRUCKS: readonly SampleTruck[] = [
  {
    ticket: "SAMPLE-0104",
    plate: "XX 00 AA 0104",
    material: "Cement Bags",
    waitingMin: 18,
    status: { tone: "wait", label: "status.waiting" },
    toVerify: true,
  },
  {
    ticket: "SAMPLE-0103",
    plate: "XX 00 BB 0103",
    material: "Bitumen",
    waitingMin: 6,
    status: { tone: "info", label: "status.arrived" },
    toVerify: true,
  },
  {
    ticket: "SAMPLE-0102",
    plate: "XX 00 CC 0102",
    material: "Steel Bars",
    waitingMin: null,
    status: { tone: "go", label: "status.completed" },
    toVerify: false,
  },
  {
    ticket: "SAMPLE-0101",
    plate: "XX 00 DD 0101",
    material: "Additive",
    waitingMin: null,
    status: { tone: "stop", label: "status.rejected" },
    toVerify: false,
  },
  {
    ticket: "SAMPLE-0100",
    plate: "XX 00 EE 0100",
    material: "Cement Bags",
    waitingMin: null,
    status: { tone: "idle", label: "status.notStarted" },
    toVerify: false,
  },
];

export interface SampleRequest {
  ticket: string;
  plate: string;
  material: string;
  request: { tone: Tone; label: MessageKey };
}

export const SAMPLE_REQUESTS: readonly SampleRequest[] = [
  {
    ticket: "SAMPLE-0207",
    plate: "XX 00 FF 0207",
    material: "Steel Scrap",
    request: { tone: "info", label: "request.type2" },
  },
  {
    ticket: "SAMPLE-0206",
    plate: "XX 00 GG 0206",
    material: "Aggregate 20 mm",
    request: { tone: "wait", label: "request.hold" },
  },
  {
    ticket: "SAMPLE-0205",
    plate: "XX 00 HH 0205",
    material: "Sand",
    request: { tone: "stop", label: "request.mismatch" },
  },
  {
    ticket: "SAMPLE-0204",
    plate: "XX 00 JJ 0204",
    material: "Sand",
    request: { tone: "info", label: "request.type2" },
  },
];

export interface SampleAlert {
  id: string;
  kind: "info" | "wait" | "stop";
  title: MessageKey;
  detail: MessageKey;
  values: Record<string, string | number>;
  time: string;
}

export const SAMPLE_ALERTS: Record<"supervisor" | "store", readonly SampleAlert[]> = {
  supervisor: [
    {
      id: "a1",
      kind: "wait",
      title: "alert.waitingLong.title",
      detail: "alert.waitingLong.detail",
      values: { plate: "XX 00 AA 0104", minutes: 18 },
      time: "10:20",
    },
    {
      id: "a2",
      kind: "stop",
      title: "alert.noMatch.title",
      detail: "alert.noMatch.detail",
      values: { plate: "XX 00 DD 0101" },
      time: "09:45",
    },
    {
      id: "a3",
      kind: "info",
      title: "alert.newTruck.title",
      detail: "alert.newTruck.detail",
      values: { plate: "XX 00 BB 0103" },
      time: "09:10",
    },
  ],
  store: [
    {
      id: "b1",
      kind: "wait",
      title: "alert.hold.title",
      detail: "alert.hold.detail",
      values: { plate: "XX 00 GG 0206" },
      time: "10:20",
    },
    {
      id: "b2",
      kind: "info",
      title: "alert.type2.title",
      detail: "alert.type2.detail",
      values: { plate: "XX 00 FF 0207" },
      time: "09:45",
    },
    {
      id: "b3",
      kind: "stop",
      title: "alert.help.title",
      detail: "alert.help.detail",
      values: {},
      time: "09:10",
    },
  ],
};
