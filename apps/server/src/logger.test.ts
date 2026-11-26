import { describe, expect, it } from "vitest";
import { scrubUrl } from "./logger";

describe("scrubUrl", () => {
  it.each([
    ["/api/upload/abcDEF_123-456789xyz", "/api/upload/[Redacted]"],
    ["/api/upload/abcDEF_123-456789xyz?x=1", "/api/upload/[Redacted]?x=1"],
    ["/api/files/a.jpg?expires=1&sig=secret", "/api/files/a.jpg?expires=1&sig=[Redacted]"],
    ["/api/tickets/12", "/api/tickets/12"],
  ])("%s", (url, expected) => {
    expect(scrubUrl(url)).toBe(expected);
  });
});
