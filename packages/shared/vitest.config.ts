import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "text-summary"],
      // "pnpm test:coverage" fails if coverage drops below these.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
