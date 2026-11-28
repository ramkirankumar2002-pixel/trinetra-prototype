import { describe, expect, it } from "vitest";
import { afterLoginPath, areaOf, loginPath } from "./areas";

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

describe("the demo settings", () => {
  it("belong to the store officer's login, which comes back to them", () => {
    expect(areaOf("/settings")).toBe("store");
    const login = loginPath("store", "/settings");
    expect(login).toBe("/store/login?next=%2Fsettings");
    expect(afterLoginPath("store", new URL(login, "http://x").search)).toBe("/settings");
  });

  it("are no way into another part", () => {
    expect(afterLoginPath("supervisor", "?next=/settings")).toBe("/supervisor");
    expect(afterLoginPath("store", "?next=/settingsx")).toBe("/store");
  });

  it.each(["/", "/t/0123456789abcdef0123456789abcdef"])("leave %s public", (path) => {
    expect(areaOf(path)).toBeUndefined();
  });
});
