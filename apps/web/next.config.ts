import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
