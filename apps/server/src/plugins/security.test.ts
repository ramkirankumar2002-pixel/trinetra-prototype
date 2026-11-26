import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { testEnv } from "../test/env";

let app: FastifyInstance;
const logLines: string[] = [];

beforeAll(async () => {
  app = await buildApp({
    env: testEnv(),
    logger: { write: (line: string) => void logLines.push(line) },
  });
});
afterAll(() => app.close());

const health = (headers: Record<string, string> = {}) =>
  app.inject({ method: "GET", url: "/api/health", headers });

describe("security plugins", () => {
  it("lets the website call the API with cookies", async () => {
    const response = await health({ origin: "http://localhost:3000" });
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("gives other websites no CORS permission", async () => {
    const response = await health({ origin: "https://evil.example" });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows PATCH in the CORS preflight", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/health",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "PATCH" },
    });
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("sends secure headers and a rate limit", async () => {
    const response = await health();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toBeDefined();
    expect(response.headers["content-security-policy"]).toBeDefined();
    expect(response.headers["x-ratelimit-limit"]).toBe("300");
  });
});

describe("logging", () => {
  it("hides secret fields", () => {
    logLines.length = 0;
    const secret = "s3cr3t-value";
    app.log.info(
      {
        pin: secret,
        body: { password: secret, token: secret, pinHash: secret },
        req2: { headers: { authorization: secret, cookie: secret } },
        res2: { headers: { "set-cookie": secret } },
      },
      "secrets",
    );

    expect(logLines).toHaveLength(1);
    expect(logLines[0]).not.toContain(secret);
    expect(logLines[0]).toContain("[Redacted]");
  });

  it("hides a signature in the address", async () => {
    logLines.length = 0;
    await app.inject({ method: "GET", url: "/api/health?sig=s3cr3t-value&a=1" });

    const log = logLines.join("");
    expect(log).toContain("sig=[Redacted]&a=1");
    expect(log).not.toContain("s3cr3t-value");
  });
});
