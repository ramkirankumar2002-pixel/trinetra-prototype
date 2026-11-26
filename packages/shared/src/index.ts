export const APP_NAME = "Trinetra Systems";

export const WEIGHBRIDGE_ID = "WB-01";

/** Body returned by GET /api/health. */
export interface HealthResponse {
  status: "ok";
  service: "trinetra-server";
  /** Server time as an ISO 8601 string in UTC. */
  time: string;
}

export * from "./api";
export * from "./auth";
export * from "./domain";
