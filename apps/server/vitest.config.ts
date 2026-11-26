import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several test files wipe and reuse the one test database.
    fileParallelism: false,
    // Blocks the real Plate Recognizer and Gemini APIs.
    setupFiles: ["src/test/no-real-apis.ts"],
  },
});
