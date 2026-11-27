import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient, newIdempotencyKey } from "./api";

interface Call {
  path: string;
  init: RequestInit;
  headers: Record<string, string>;
}

function setUp(answer: () => Response | Promise<Response>, at = "/store") {
  const calls: Call[] = [];
  const goTo = vi.fn();
  const client = createApiClient({
    fetch: (async (path: string, init: RequestInit) => {
      calls.push({ path, init, headers: init.headers as Record<string, string> });
      return answer();
    }) as typeof fetch,
    currentPath: () => at,
    goTo,
  });
  return { client, calls, goTo };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status });
const refusal = (status: number, code: string, details?: unknown) =>
  json({ error: { code, message: `${code} happened.`, ...(details ? { details } : {}) } }, status);
const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
};

describe("API client: requests", () => {
  it("returns the JSON answer and sends the login cookie", async () => {
    const { client, calls } = setUp(json({ user: { id: 1 } }));
    await expect(client.get("/api/auth/me")).resolves.toEqual({ user: { id: 1 } });
    expect(calls[0]!.path).toBe("/api/auth/me");
    expect(calls[0]!.init).toMatchObject({ method: "GET", credentials: "include" });
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it("sends a body as JSON", async () => {
    const { client, calls } = setUp(json({}));
    await client.post("/api/help", { body: { ticketId: 4 } });
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe('{"ticketId":4}');
  });

  it("sends a form as it is, so the browser sets its type", async () => {
    const { client, calls } = setUp(json({}));
    const form = new FormData();
    await client.post("/api/upload/abc", { body: form });
    expect(calls[0]!.headers["content-type"]).toBeUndefined();
    expect(calls[0]!.init.body).toBe(form);
  });
});

describe("API client: Idempotency-Key", () => {
  it.each(["post", "patch", "put"] as const)("is on every %s", async (method) => {
    const { client, calls } = setUp(json({}));
    await client[method]("/api/x");
    expect(calls[0]!.headers["idempotency-key"]).toMatch(/^[A-Za-z0-9._:-]{16,200}$/);
  });

  it("is not on a GET", async () => {
    const { client, calls } = setUp(json({}));
    await client.get("/api/x");
    expect(calls[0]!.headers).not.toHaveProperty("idempotency-key");
  });

  it("is new for each press, and the same when the caller retries one", async () => {
    const { client, calls } = setUp(json({}));
    await client.post("/api/x");
    await client.post("/api/x");
    const press = newIdempotencyKey();
    await client.post("/api/x", { idempotencyKey: press });
    await client.post("/api/x", { idempotencyKey: press });
    const keys = calls.map((call) => call.headers["idempotency-key"]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.slice(2)).toEqual([press, press]);
  });

  it("can be made without randomUUID, as on a plain HTTP address", () => {
    const real = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: real, configurable: true });
    }
  });
});

describe("API client: errors", () => {
  it("turns the error JSON into an ApiError with code, message and details", async () => {
    const { client } = setUp(refusal(429, "LOCKED", { secondsLeft: 42 }));
    const error = await failure(client.post("/api/auth/login"));
    expect(error).toMatchObject({
      status: 429,
      code: "LOCKED",
      message: "LOCKED happened.",
      details: { secondsLeft: 42 },
      retryable: false,
    });
  });

  it("says NETWORK_ERROR when there is no answer", async () => {
    const { client } = setUp(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await failure(client.get("/api/x"))).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      retryable: true,
    });
  });

  it("says SERVER_UNREACHABLE for the proxy's answer when the backend is down", async () => {
    const { client } = setUp(() => new Response("Internal Server Error", { status: 500 }));
    expect(await failure(client.get("/api/x"))).toMatchObject({
      status: 500,
      code: "SERVER_UNREACHABLE",
      retryable: true,
    });
  });

  it("refuses a success that is not JSON", async () => {
    const { client } = setUp(() => new Response("<html>", { status: 200 }));
    expect((await failure(client.get("/api/x"))).code).toBe("BAD_RESPONSE");
  });

  it("passes on a cancelled request as it is", async () => {
    const controller = new AbortController();
    controller.abort();
    const { client } = setUp(() => Promise.reject(new DOMException("stopped", "AbortError")));
    await expect(client.get("/api/x", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("API client: an ended login", () => {
  it.each([
    ["/kiosk", "/kiosk/login"],
    // With the page to come back to after logging in.
    ["/kiosk/settings", "/kiosk/login?next=%2Fkiosk%2Fsettings"],
    ["/supervisor", "/supervisor/login"],
    ["/store/requests/7", "/store/login?next=%2Fstore%2Frequests%2F7"],
  ])("on %s goes to %s", async (at, login) => {
    const { client, goTo } = setUp(refusal(401, "NOT_LOGGED_IN"), at);
    expect((await failure(client.get("/api/x"))).code).toBe("NOT_LOGGED_IN");
    expect(goTo).toHaveBeenCalledExactlyOnceWith(login);
  });

  it.each(["/", "/live", "/t/WB01-20261126-0001", "/storehouse", "/store/login"])(
    "stays on %s",
    async (at) => {
      const { client, goTo } = setUp(refusal(401, "NOT_LOGGED_IN"), at);
      await failure(client.get("/api/x"));
      expect(goTo).not.toHaveBeenCalled();
    },
  );

  it("is not what a wrong PIN or a wrong role means", async () => {
    for (const answer of [refusal(401, "INVALID_CREDENTIALS"), refusal(403, "WRONG_ROLE")]) {
      const { client, goTo } = setUp(answer);
      await failure(client.post("/api/x"));
      expect(goTo).not.toHaveBeenCalled();
    }
  });

  it("can be left to the caller", async () => {
    const { client, goTo } = setUp(refusal(401, "NOT_LOGGED_IN"));
    await failure(client.get("/api/auth/me", { redirectOn401: false }));
    expect(goTo).not.toHaveBeenCalled();
  });
});
