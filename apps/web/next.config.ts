import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stops `next dev` from writing AGENTS.md; this project's rules live in CLAUDE.md.
  agentRules: false,
  // The shared package is plain TypeScript, so Next compiles it itself.
  transpilePackages: ["@trinetra/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
