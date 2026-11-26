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
