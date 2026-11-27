import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { isTemporary } from "./session";

describe("a login check that failed", () => {
  it.each([
    [0, "NETWORK_ERROR"],
    [502, "SERVER_UNREACHABLE"],
    [429, "RATE_LIMITED"],
  ])("is asked again after %i %s", (status, code) => {
    expect(isTemporary(new ApiError(status, code, "x"))).toBe(true);
  });

  it("is not asked again when it was refused", () => {
    expect(isTemporary(new ApiError(401, "NOT_LOGGED_IN", "x"))).toBe(false);
    expect(isTemporary(null)).toBe(false);
  });
});
