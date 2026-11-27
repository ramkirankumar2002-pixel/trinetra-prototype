import { describe, expect, it } from "vitest";
import { isLocalOnlyUrl } from "./public-url";

describe("isLocalOnlyUrl", () => {
  it.each([
    "http://localhost:3000",
    "https://LOCALHOST",
    "http://127.0.0.1:3000",
    "http://127.8.8.8",
    "http://[::1]:3000",
    "http://0.0.0.0:3000",
    "http://trinetra.localhost:3000",
  ])("%s only works on this computer", (url) => expect(isLocalOnlyUrl(url)).toBe(true));

  it.each([
    "https://192.168.1.20:3000",
    "https://10.0.0.5:3000",
    "https://trinetra.vercel.app",
    "https://localhost.example.com",
    "not an address",
  ])("%s does not", (url) => expect(isLocalOnlyUrl(url)).toBe(false));
});
