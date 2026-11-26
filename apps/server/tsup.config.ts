import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  sourcemap: true,
  // The shared package is plain TypeScript, so it must be bundled into the output.
  noExternal: ["@trinetra/shared"],
});
