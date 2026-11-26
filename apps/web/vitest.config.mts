import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Component tests ask for a browser-like page with "// @vitest-environment jsdom".
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  test: { include: ["src/**/*.test.{ts,tsx}"] },
});
