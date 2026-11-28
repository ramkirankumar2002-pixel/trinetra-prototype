import { SEED_USERS } from "@trinetra/shared/seed";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app";
import { SESSION_COOKIES } from "../plugins/security";
import { createDb } from "../db/client";
import { seedDatabase } from "../db/seed";
import { resetTestDatabase } from "../test/database";
import { testDatabaseUrl, testEnv } from "../test/env";

describe.skipIf(!testDatabaseUrl)("auth", { timeout: 30_000 }, () => {
  let app: FastifyInstance;
  let time: number;

  beforeAll(async () => {
    await resetTestDatabase(testDatabaseUrl!);
    const { db, close } = createDb(testDatabaseUrl!, { max: 1 });
    await seedDatabase(db);
    await close();
  }, 60_000);

  // A new app for each test: empty rate limits and lockouts.
  beforeEach(async () => {
    time = Date.now();
    app = await buildApp({ env: testEnv(), now: () => time });
  });
  afterEach(() => app.close());

  const login = (username: string, pin: string) =>
    app.inject({ method: "POST", url: "/api/auth/login", payload: { username, pin } });

  async function sessionFor(username: string, pin: string): Promise<string> {
    const response = await login(username, pin);
    return response.cookies[0]!.value;
  }

  /** The role inside a token, or KIOSK's cookie for something that is not a token. */
  const roleOf = (token: string) =>
    (token.includes(".") && app.jwt.decode<{ role: keyof typeof SESSION_COOKIES }>(token)?.role) ||
    "KIOSK";

  /** A token goes in the cookie of its own role. */
  const get = (url: string, session?: string) =>
    app.inject({
      method: "GET",
      url,
      ...(session ? { cookies: { [SESSION_COOKIES[roleOf(session)]]: session } } : {}),
    });

  const lifetime = (token: string) => {
    const { exp, iat } = app.jwt.decode<{ exp: number; iat: number }>(token)!;
    return exp - iat;
  };

  describe("login", () => {
    it.each(SEED_USERS)("accepts the demo PIN of $username", async ({ username, pin, role }) => {
      const response = await login(username, pin);
      expect(response.statusCode).toBe(200);
      expect(response.json().user).toMatchObject({ username, role });
    });

    it("returns the user without any hash or PIN", async () => {
      const response = await login("amit", "1001");
      expect(response.json()).toEqual({
        user: { id: expect.any(Number), username: "amit", name: "Amit Kumar", role: "SUPERVISOR" },
      });
    });

    it("sets a 12 hour httpOnly cookie that holds userId, role and name", async () => {
      const response = await login("amit", "1001");
      const cookie = response.cookies.find((c) => c.name === SESSION_COOKIES.SUPERVISOR)!;
      expect(response.cookies).toHaveLength(1);

      expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", maxAge: 43200 });
      expect(cookie.secure).toBeUndefined();
      expect(lifetime(cookie.value)).toBe(43200);
      expect(app.jwt.decode(cookie.value)).toMatchObject({
        userId: response.json().user.id,
        role: "SUPERVISOR",
        name: "Amit Kumar",
      });
    });

    it("marks the cookie Secure in production", async () => {
      const production = await buildApp({ env: testEnv({ NODE_ENV: "production" }) });
      const response = await production.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "amit", pin: "1001" },
      });
      await production.close();
      expect(response.cookies[0]).toMatchObject({ secure: true, httpOnly: true });
    });

    it("ignores capitals and spaces around the username", async () => {
      expect((await login("  Amit ", "1001")).statusCode).toBe(200);
    });

    it("gives the same answer for a wrong PIN and an unknown user", async () => {
      const wrongPin = await login("amit", "9999");
      const unknown = await login("nobody", "9999");

      expect(wrongPin.statusCode).toBe(401);
      expect(wrongPin.json().error.code).toBe("INVALID_CREDENTIALS");
      expect(unknown.json()).toEqual(wrongPin.json());
      expect(wrongPin.cookies).toHaveLength(0);
    });

    it("answers 400 for a missing or badly formed PIN", async () => {
      const response = await login("amit", "12ab");
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({
        code: "VALIDATION_ERROR",
        details: [{ field: "pin" }],
      });
    });

    it("locks after 5 wrong PINs, even for the right PIN, then unlocks", async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect((await login("amit", "9999")).statusCode).toBe(401);
      }
      const fifth = await login("amit", "9999");
      expect(fifth.statusCode).toBe(429);
      expect(fifth.json().error).toMatchObject({ code: "LOCKED", details: { secondsLeft: 60 } });
      expect(fifth.headers["retry-after"]).toBe("60");

      time += 25_000;
      const early = await login("amit", "1001");
      expect(early.json().error).toMatchObject({ code: "LOCKED", details: { secondsLeft: 35 } });

      // Other users are not affected.
      expect((await login("ram", "2001")).statusCode).toBe(200);

      time += 35_000;
      expect((await login("amit", "1001")).statusCode).toBe(200);
    });

    it("lets only 5 guesses through when they arrive together", async () => {
      const responses = await Promise.all(Array.from({ length: 12 }, () => login("amit", "9999")));
      const wrong = responses.filter((r) => r.json().error.code === "INVALID_CREDENTIALS");
      expect(wrong).toHaveLength(4);
      expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(8);
    });

    it("has a stricter rate limit than the rest of the API", async () => {
      const responses = [];
      for (let i = 0; i < 21; i++) responses.push(await login(`user${i}`, "9999"));

      expect(responses[19]!.statusCode).toBe(401);
      expect(responses[20]!.json().error.code).toBe("RATE_LIMITED");
      expect((await get("/api/health")).statusCode).toBe(200);
    });
  });

  describe("session", () => {
    it("me returns the logged-in user", async () => {
      const response = await get("/api/auth/me", await sessionFor("ram", "2001"));
      expect(response.json().user).toMatchObject({ username: "ram", role: "STORE" });
    });

    it.each([
      ["no cookie", undefined],
      ["a forged cookie", "not-a-token"],
    ])("me answers 401 with %s", async (_label, session) => {
      const response = await get("/api/auth/me", session);
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("NOT_LOGGED_IN");
    });

    it("refuses an expired cookie", async () => {
      const expired = app.jwt.sign({
        userId: 1,
        role: "SUPERVISOR",
        name: "Amit Kumar",
        use: "session",
        // Issued 13 hours ago and valid for 12.
        iat: Math.floor(Date.now() / 1000) - 13 * 3600,
        exp: Math.floor(Date.now() / 1000) - 3600,
      } as never);
      expect((await get("/api/auth/me", expired)).statusCode).toBe(401);
    });

    it("accepts the token only from the cookie", async () => {
      const session = await sessionFor("amit", "1001");
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${session}` },
      });
      expect(response.statusCode).toBe(401);
    });

    it("logout clears the cookie", async () => {
      const response = await app.inject({ method: "POST", url: "/api/auth/logout" });
      expect(response.statusCode).toBe(200);
      // With no app named, every app's cookie goes.
      expect(response.cookies.map((c) => c.name).sort()).toEqual(
        Object.values(SESSION_COOKIES).sort(),
      );
      for (const cookie of response.cookies) {
        expect(cookie.value).toBe("");
        expect(cookie.expires!.getTime()).toBeLessThan(Date.now());
      }
    });

    it("gives a 60 second socket token that cannot be used as a login", async () => {
      const response = await get("/api/auth/socket-token", await sessionFor("wb01", "3001"));
      const { token, expiresInSeconds } = response.json();

      expect(expiresInSeconds).toBe(60);
      expect(lifetime(token)).toBe(60);
      expect(app.jwt.decode(token)).toMatchObject({ role: "KIOSK", use: "socket" });
      expect((await get("/api/auth/me", token)).statusCode).toBe(401);
      expect((await get("/api/auth/socket-token", token)).statusCode).toBe(401);
    });

    it("gives no socket token without a login", async () => {
      expect((await get("/api/auth/socket-token")).statusCode).toBe(401);
    });
  });

  describe("three apps in one browser", () => {
    const APPS = {
      kiosk: { username: "wb01", pin: "3001", role: "KIOSK" },
      supervisor: { username: "amit", pin: "1001", role: "SUPERVISOR" },
      store: { username: "ram", pin: "2001", role: "STORE" },
    } as const;
    type AppName = keyof typeof APPS;
    const NAMES = Object.keys(APPS) as AppName[];

    /** A browser: one cookie jar, and each page names its app. */
    function browser() {
      const jar: Record<string, string> = {};
      const send = async (app_: AppName, method: "GET" | "POST", url: string, body?: object) => {
        const response = await app.inject({
          method,
          url,
          headers: { "x-trinetra-app": app_ },
          cookies: { ...jar },
          ...(body ? { payload: body } : {}),
        });
        for (const { name, value } of response.cookies) {
          if (value) jar[name] = value;
          else delete jar[name];
        }
        return response;
      };
      const logIn = (app_: AppName, as: AppName = app_) =>
        send(app_, "POST", "/api/auth/login", {
          username: APPS[as].username,
          pin: APPS[as].pin,
        });
      const who = async (app_: AppName) =>
        (await send(app_, "GET", "/api/auth/me")).json().user?.role ?? null;
      return { jar, send, logIn, who };
    }

    async function allThree() {
      const tab = browser();
      for (const name of NAMES) expect((await tab.logIn(name)).statusCode).toBe(200);
      return tab;
    }

    it("keeps all three logged in, each seen as itself", async () => {
      const tab = await allThree();
      expect(Object.keys(tab.jar).sort()).toEqual(Object.values(SESSION_COOKIES).sort());
      for (const name of NAMES) expect(await tab.who(name)).toBe(APPS[name].role);
    });

    it("still checks the role on every request, by the cookie of the app that asks", async () => {
      const tab = await allThree();
      for (const asking of NAMES) {
        for (const owner of NAMES) {
          const url = `/api/test/${APPS[owner].role.toLowerCase()}`;
          const response = await tab.send(asking, "GET", url);
          expect(response.statusCode, `${asking} asking ${url}`).toBe(asking === owner ? 200 : 403);
        }
      }
    });

    it("gives each app the live token of its own login", async () => {
      const tab = await allThree();
      for (const name of NAMES) {
        const { token } = (await tab.send(name, "GET", "/api/auth/socket-token")).json();
        expect(app.jwt.decode(token)).toMatchObject({ role: APPS[name].role, use: "socket" });
      }
    });

    it.each(NAMES)("logging out of the %s leaves the other two logged in", async (leaving) => {
      const tab = await allThree();
      await tab.send(leaving, "POST", "/api/auth/logout");
      for (const name of NAMES) {
        expect(await tab.who(name)).toBe(name === leaving ? null : APPS[name].role);
      }
    });

    it("logs nobody in for another app's PIN, and keeps that app's login", async () => {
      const tab = browser();
      await tab.logIn("supervisor");
      const before = { ...tab.jar };

      const refused = await tab.logIn("kiosk", "supervisor");
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toMatchObject({
        code: "WRONG_APP",
        details: { role: "SUPERVISOR" },
      });
      expect(refused.cookies).toHaveLength(0);
      expect(tab.jar).toEqual(before);
      expect(await tab.who("kiosk")).toBeNull();
    });

    it("does not believe a login put in another app's cookie", async () => {
      const session = await sessionFor("ram", "2001");
      const response = await app.inject({
        method: "GET",
        url: "/api/test/kiosk",
        headers: { "x-trinetra-app": "kiosk" },
        cookies: { [SESSION_COOKIES.KIOSK]: session },
      });
      expect(response.statusCode).toBe(401);
    });

    it("treats an unknown app name as no login", async () => {
      const session = await sessionFor("ram", "2001");
      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { "x-trinetra-app": "admin" },
        cookies: { [SESSION_COOKIES.STORE]: session },
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
