// MADE-UP DATA for the store officer's dashboard home, until Phase 13 loads real
// requests. Every card that shows it carries the "Sample" mark. The plates start with
// "XX" and the tickets with "SAMPLE", so none can be taken for real. Delete this file
// when the real lists arrive.
import type { MessageKey } from "@/i18n/translate";
import type { Tone } from "@/components/ui/tone";

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

export const SAMPLE_ALERTS: readonly SampleAlert[] = [
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
];
