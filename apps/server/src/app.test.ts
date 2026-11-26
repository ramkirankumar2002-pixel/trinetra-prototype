import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { testEnv } from "./test/env";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ env: testEnv() });
});
afterAll(() => app.close());

describe("GET /api/health", () => {
  it("answers ok", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "trinetra-server" });
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });
});
