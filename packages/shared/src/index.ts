export const APP_NAME = "Trinetra Systems";

/** Body returned by GET /api/health. */
export interface HealthResponse {
  /** "degraded" (HTTP 503) when the database is down. */
  status: "ok" | "degraded";
  database: "up" | "down";
  service: "trinetra-server";
  /** Server time as an ISO 8601 string in UTC. */
  time: string;
}

export * from "./api";
export * from "./auth";
export * from "./domain";
export * from "./rules/plates";
export * from "./rules/classify";
export * from "./rules/unloading";
export * from "./rules/weight";
export * from "./rules/stability";
export { matchFromList, type ListMatch } from "./matching/list";
export { matchMaterial, type MatchableMaterial, type MaterialMatch } from "./matching/material";
export { parseDigits, parseYesNo } from "./matching/speech";
export * from "./rules/ticket-state";
export * from "./format";
export * from "./public-url";
export * from "./hardware";
export * from "./readers";
export * from "./realtime";
export * from "./tickets";
export * from "./weighbridge";
