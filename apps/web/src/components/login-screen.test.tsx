// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/query-client";
import { LoginScreen } from "./login-screen";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const refusal = (status: number, code: string, details?: unknown) =>
  reply(status, { error: { code, message: "no", ...(details ? { details } : {}) } });

let loginAnswers: Response[];
let calls: string[];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
  loginAnswers = [];
  calls = [];
  vi.stubGlobal("fetch", async (path: string) => {
    calls.push(path);
    if (path === "/api/auth/login") return loginAnswers.shift()!;
    if (path === "/api/auth/logout") return reply(200, { ok: true });
    return refusal(401, "NOT_LOGGED_IN");
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const goTo = vi.fn();
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

function open() {
  goTo.mockClear();
  render(
    <QueryClientProvider client={createQueryClient()}>
      <LoginScreen area="store" goTo={goTo} />
    </QueryClientProvider>,
  );
}

function type(username: string, pin: string) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  for (const digit of pin) fireEvent.click(button(digit));
}

const submit = () => act(async () => void fireEvent.click(button("Log in")));

describe("login page", () => {
  it("cannot be typed in before the browser has taken the page over", () => {
    const page = document.createElement("div");
    // As the server sends it.
    page.innerHTML = renderToString(
      <QueryClientProvider client={createQueryClient()}>
        <LoginScreen area="store" goTo={goTo} />
      </QueryClientProvider>,
    );
    expect(page.querySelector("input")!.disabled).toBe(true);
    const keys = page.querySelectorAll<HTMLButtonElement>('[role="group"] button');
    expect([...keys].slice(0, 12).every((key) => key.disabled)).toBe(true);

    open();
    expect((screen.getByLabelText("Username") as HTMLInputElement).disabled).toBe(false);
  });

  it("needs a username and at least 4 digits", () => {
    open();
    type("ram", "200");
    expect(button("Log in").disabled).toBe(true);
    fireEvent.click(button("1"));
    expect(button("Log in").disabled).toBe(false);
  });

  it("goes to the store page after a store login, and remembers the username only", async () => {
    loginAnswers = [reply(200, { user: { id: 1, username: "ram", name: "Ram", role: "STORE" } })];
    open();
    type(" Ram ", "2001");
    await submit();
    expect(goTo).toHaveBeenCalledExactlyOnceWith("/store");
    expect({ ...localStorage }).toEqual({ "trinetra.username.store": "ram" });
  });

  it("says a wrong PIN in plain words and clears it", async () => {
    loginAnswers = [refusal(401, "INVALID_CREDENTIALS")];
    open();
    type("ram", "9999");
    await submit();
    expect(screen.getByRole("alert").textContent).toBe("Wrong username or PIN. Try again.");
    expect(screen.getByText("Digits typed: 0")).toBeTruthy();
    expect(goTo).not.toHaveBeenCalled();
  });

  it("counts down the lock, and unlocks when it ends", async () => {
    loginAnswers = [refusal(429, "LOCKED", { secondsLeft: 60 })];
    open();
    type("ram", "9999");
    await submit();
    const alert = () => screen.queryByRole("alert")?.textContent;
    expect(alert()).toBe("Too many wrong PINs. Wait 60 seconds.");
    expect(button("1").disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(18_000));
    expect(alert()).toBe("Too many wrong PINs. Wait 42 seconds.");

    // The lock is for that username only.
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "other" } });
    expect(button("1").disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ram" } });

    await act(() => vi.advanceTimersByTimeAsync(43_000));
    expect(alert()).toBeUndefined();
    expect(button("1").disabled).toBe(false);
  });

  it("does not keep a login for another role", async () => {
    // The server logs nobody in for another page's role.
    loginAnswers = [refusal(403, "WRONG_APP", { role: "SUPERVISOR" })];
    open();
    type("amit", "1001");
    await submit();
    expect(screen.getByRole("alert").textContent).toBe(
      "That is a supervisor login. This page needs a store officer login.",
    );
    // Nothing to undo, so no logout: the supervisor's own page keeps its login.
    expect(calls).not.toContain("/api/auth/logout");
    expect(goTo).not.toHaveBeenCalled();
  });
});
