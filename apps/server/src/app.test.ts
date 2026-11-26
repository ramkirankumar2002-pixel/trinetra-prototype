import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { testDatabaseUrl, testEnv } from "./test/env";

async function health(databaseUrl: string) {
  const app = await buildApp({ env: testEnv({ DATABASE_URL: databaseUrl }) });
  try {
    return await app.inject({ method: "GET", url: "/api/health" });
  } finally {
    await app.close();
  }
}

describe("GET /api/health", { timeout: 20_000 }, () => {
  it.skipIf(!testDatabaseUrl)("answers ok when the database is up", async () => {
    const response = await health(testDatabaseUrl!);

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ status: "ok", database: "up", service: "trinetra-server" });
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });

  it("answers 503 degraded when the database refuses connections", async () => {
    // Nothing listens on port 1.
    const response = await health("postgres://postgres:secretpass@127.0.0.1:1/trinetra");

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "degraded", database: "down" });
    expect(response.body).not.toContain("secretpass");
    expect(response.body).not.toContain("127.0.0.1");
  });

  it("answers 503 within a few seconds when the database never replies", async () => {
    // Accepts the connection and then stays silent.
    const sockets: Socket[] = [];
    const silent = createServer((socket) => sockets.push(socket));
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as { port: number };

    const started = Date.now();
    const app = await buildApp({
      env: testEnv({ DATABASE_URL: `postgres://postgres:x@127.0.0.1:${port}/trinetra` }),
    });
    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(503);
      expect(Date.now() - started).toBeLessThan(4500);
    } finally {
      sockets.forEach((socket) => socket.destroy());
      silent.close();
      await app.close();
    }
  });
});
