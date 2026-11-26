import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://postgres:postgres@localhost:5433/trinetra",
  JWT_SECRET: "a-test-secret-that-is-long-enough-123",
  FRONTEND_ORIGIN: "http://localhost:3000",
  STORAGE_DRIVER: "local",
};

describe("parseEnv", () => {
  it("fills in the defaults, treating empty values as missing", () => {
    expect(parseEnv({ ...valid, PORT: "", TZ: "" })).toMatchObject({
      NODE_ENV: "development",
      PORT: 4000,
      TZ: "Asia/Kolkata",
    });
  });

  it("uses the current Gemini Flash model unless another is named", () => {
    expect(parseEnv(valid).GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(parseEnv({ ...valid, GEMINI_MODEL: "gemini-3.5-flash" }).GEMINI_MODEL).toBe(
      "gemini-3.5-flash",
    );
    expect(() => parseEnv({ ...valid, GEMINI_MODEL: "a b/c" })).toThrow(/- GEMINI_MODEL /);
  });

  it("has a backup Gemini model unless another is named", () => {
    expect(parseEnv({ ...valid, GEMINI_FALLBACK_MODEL: "" }).GEMINI_FALLBACK_MODEL).toBe(
      "gemini-3.5-flash-lite",
    );
    expect(
      parseEnv({ ...valid, GEMINI_FALLBACK_MODEL: "gemini-3.6-flash" }).GEMINI_FALLBACK_MODEL,
    ).toBe("gemini-3.6-flash");
    expect(() => parseEnv({ ...valid, GEMINI_FALLBACK_MODEL: "Bad Name" })).toThrow(
      /- GEMINI_FALLBACK_MODEL /,
    );
  });

  it("does not need the settings of later phases", () => {
    expect(parseEnv(valid).GEMINI_API_KEY).toBeUndefined();
  });

  it("names every missing required variable", () => {
    expect(() => parseEnv({})).toThrow(
      /DATABASE_URL is required[\s\S]*JWT_SECRET is required[\s\S]*FRONTEND_ORIGIN is required[\s\S]*STORAGE_DRIVER is required/,
    );
  });

  it.each([
    ["JWT_SECRET", "short"],
    ["DATABASE_URL", "mysql://localhost/trinetra"],
    ["DATABASE_URL", "postgres://localhost:5433"],
    ["FRONTEND_ORIGIN", "http://localhost:3000/"],
    ["FRONTEND_ORIGIN", "*"],
    ["STORAGE_DRIVER", "disk"],
    ["PORT", "abc"],
    ["PORT", "70000"],
    ["TZ", "India/Nowhere"],
    ["NODE_ENV", "prod"],
  ])("refuses a wrong %s", (name, value) => {
    expect(() => parseEnv({ ...valid, [name]: value })).toThrow(new RegExp(`- ${name} `));
  });

  it.each(["DEVICE_TOKEN", "CAM_FRONT_TOKEN", "CAM_BACK_TOKEN"])("refuses a short %s", (name) => {
    expect(() => parseEnv({ ...valid, [name]: "too-short" })).toThrow(new RegExp(`- ${name} `));
  });

  it("refuses two devices with the same token", () => {
    const token = "same-token-for-two-devices";
    expect(() => parseEnv({ ...valid, DEVICE_TOKEN: token, CAM_BACK_TOKEN: token })).toThrow(
      /CAM_BACK_TOKEN must be different/,
    );
  });

  it("requires the Supabase settings only for the supabase driver", () => {
    expect(() => parseEnv({ ...valid, STORAGE_DRIVER: "supabase" })).toThrow(
      /SUPABASE_URL is required[\s\S]*SUPABASE_SERVICE_KEY[\s\S]*STORAGE_BUCKET/,
    );
  });

  it("never prints a value in the error message", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "hunter2" })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("hunter2") }),
    );
  });
});
