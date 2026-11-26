import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/next-env.d.ts",
    "**/test-results/**",
    "**/playwright-report/**",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  // Next.js and React rules, only for the website.
  ...nextVitals.map((config) => ({ ...config, files: ["apps/web/**/*.{js,mjs,ts,tsx}"] })),
  {
    files: ["apps/web/**/*.{js,mjs,ts,tsx}"],
    settings: { next: { rootDir: "apps/web/" } },
  },
  prettier,
);
