// `pnpm screenshots:kiosk` runs the kiosk tests again and saves a picture of every screen
// in docs/screenshots/phase10. Not part of the tests: it rewrites files in the repository.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

process.env.PHASE10_SHOTS = "1";

export default defineConfig(base, { testMatch: "kiosk-{journeys,fallbacks}.spec.ts" });
