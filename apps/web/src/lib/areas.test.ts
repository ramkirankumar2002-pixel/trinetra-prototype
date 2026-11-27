import { describe, expect, it } from "vitest";
import { afterLoginPath, loginPath } from "./areas";

describe("coming back after a login", () => {
  it("remembers the page that was open", () => {
    const login = loginPath("supervisor", "/supervisor/verify/12");
    expect(login).toBe("/supervisor/login?next=%2Fsupervisor%2Fverify%2F12");
    expect(afterLoginPath("supervisor", new URL(login, "http://x").search)).toBe(
      "/supervisor/verify/12",
    );
  });

  it.each(["/supervisor", "/supervisor/login", "/store/requests", "/"])(
    "needs nothing to be remembered for %s",
    (path) => expect(loginPath("supervisor", path)).toBe("/supervisor/login"),
  );

  it.each([
    "",
    "?next=https://evil.example.com",
    "?next=//evil.example.com",
    "?next=/supervisor//evil.example.com",
    "?next=/supervisor/..%2F..",
    "?next=/supervisor/\\evil",
    "?next=/store/requests",
    "?next=/supervisor/login",
    "?next=/supervisorx/a",
  ])("goes home for %s", (search) => {
    expect(afterLoginPath("supervisor", search)).toBe("/supervisor");
  });
});
