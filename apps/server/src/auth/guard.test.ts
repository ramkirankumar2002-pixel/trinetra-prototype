// The guard reads only the signed cookie, so these tests need no database.
import { USER_ROLES, type UserRole } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIES } from "../plugins/security";
import { testEnv } from "../test/env";
import { requireRole } from "./guard";

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ env: testEnv() });
  app.get(
    "/x/store-or-supervisor",
    { preHandler: requireRole("STORE", "SUPERVISOR") },
    async () => ({
      ok: true,
    }),
  );
});
afterAll(() => app.close());

const call = (url: string, role?: UserRole) =>
  app.inject({
    method: "GET",
    url,
    cookies: role
      ? { [SESSION_COOKIES[role]]: app.jwt.sign({ userId: 1, role, name: "Test", use: "session" }) }
      : {},
  });

const routeOf = (role: UserRole) => `/api/test/${role.toLowerCase()}`;

describe.each(USER_ROLES)("the %s route", (owner) => {
  it("answers 401 without a login", async () => {
    const response = await call(routeOf(owner));
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("NOT_LOGGED_IN");
  });

  it("answers 200 for its own role", async () => {
    const response = await call(routeOf(owner), owner);
    expect(response.json()).toEqual({ ok: true, role: owner, name: "Test" });
  });

  it.each(USER_ROLES.filter((role) => role !== owner))("answers 403 for %s", async (other) => {
    const response = await call(routeOf(owner), other);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("WRONG_ROLE");
  });
});

describe("requireRole with several roles", () => {
  it.each([
    ["STORE", 200],
    ["SUPERVISOR", 200],
    ["KIOSK", 403],
  ] as const)("answers %s with %i", async (role, status) => {
    expect((await call("/x/store-or-supervisor", role)).statusCode).toBe(status);
  });
});

describe("test routes", () => {
  it.each(["development", "production"])("do not exist in %s", async (nodeEnv) => {
    const other = await buildApp({ env: testEnv({ NODE_ENV: nodeEnv }) });
    for (const role of USER_ROLES) {
      const response = await other.inject({ method: "GET", url: routeOf(role) });
      expect(response.statusCode).toBe(404);
    }
    await other.close();
  });
});
