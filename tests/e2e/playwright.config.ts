// Browser tests against the real website, backend and development database (seeded with
// pnpm db:seed). A running `pnpm dev` is used; otherwise both are started.
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const WEB_URL = "http://localhost:3000";

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
      url: "http://localhost:4000/api/health",
      cwd: root,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @trinetra/web run dev",
      url: WEB_URL,
      cwd: root,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
