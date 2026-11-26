import { parseEnv, type Env } from "../config/env";
import { loadEnvFile } from "../config/paths";

loadEnvFile();

/** The test database address, or undefined when database tests must be skipped. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL || undefined;

/** Settings for tests, independent of whatever else is in apps/server/.env. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: "test",
    // Nothing listens on port 1, so tests without a real database cannot reach one by accident.
    DATABASE_URL: testDatabaseUrl ?? "postgres://postgres:postgres@127.0.0.1:1/none_test",
    JWT_SECRET: "a-test-secret-that-is-long-enough-123",
    FRONTEND_ORIGIN: "http://localhost:3000",
    STORAGE_DRIVER: "local",
    ...overrides,
  });
}
