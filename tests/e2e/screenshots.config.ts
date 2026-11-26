// `pnpm screenshots` takes the pictures in docs/screenshots again. Not part of the tests:
// it rewrites files that are in the repository.
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, { testMatch: "screenshots.shots.ts" });
