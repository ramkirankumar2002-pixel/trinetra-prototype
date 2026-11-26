import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("GET /api/health", () => {
  const app = buildApp();
  afterAll(() => app.close());

  it("answers ok", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", service: "trinetra-server" });
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });
});
