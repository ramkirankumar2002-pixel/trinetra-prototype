// Browser tests against the real website, backend and development database (seeded with
// pnpm db:seed). A running `pnpm dev` is used; otherwise both are started.
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
// E2E_WEB_PORT runs the website on another port, for when something else holds 3000.
const WEB_PORT = process.env.E2E_WEB_PORT ?? "3000";
export const WEB_URL = `http://localhost:${WEB_PORT}`;
// With E2E_BACKEND_PORT too (and NEXT_DIST_DIR and another DATABASE_URL), the tests run
// beside a "pnpm dev" or "pnpm lan" without touching it (README, "Browser tests").
const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? "4000";
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // The tests share one backend, which limits how often anyone may log in.
  workers: 1,
  timeout: 60_000,
  // The first visit to a page in development waits for Next to compile it.
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { baseURL: WEB_URL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  // The Google Chrome already on the computer: nothing else is downloaded.
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
  webServer: [
    {
      command: "pnpm --filter @trinetra/server run dev",
      url: `${BACKEND_URL}/api/health`,
      cwd: root,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // A backend started here allows the website's address (apps/server/.env does not
      // override a variable that is already set).
      env: { FRONTEND_ORIGIN: WEB_URL, PORT: BACKEND_PORT },
    },
    {
      command: `pnpm --filter @trinetra/web exec next dev --port ${WEB_PORT}`,
      url: WEB_URL,
      cwd: root,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { BACKEND_URL, NEXT_PUBLIC_SOCKET_URL: BACKEND_URL },
    },
  ],
});
