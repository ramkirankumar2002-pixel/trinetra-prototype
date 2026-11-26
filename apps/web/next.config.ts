import type { NextConfig } from "next";

// The browser calls /api/* on the website's own address and Next forwards it to the
// backend, so the login cookie belongs to the website (same-site). The address is read
// when Next starts, and for a production build when it is built.
function backendUrl(): string {
  const value = process.env.BACKEND_URL;
  if (value) return value.replace(/\/+$/, "");
  // On Vercel a missing address must stop the build, not point the site at itself.
  if (process.env.VERCEL) throw new Error("BACKEND_URL is not set.");
  return "http://localhost:4000";
}

/**
 * How long a forwarded request may take. Next's own limit is 30 s, but reading an invoice
 * can take two 30 s Gemini tries, and the plate reading waits for two cameras as well.
 */
const PROXY_TIMEOUT_MS = 120_000;

const nextConfig: NextConfig = {
  // Stops `next dev` from writing AGENTS.md; this project's rules live in CLAUDE.md.
  agentRules: false,
  // The floating dev-tools badge sits over the bottom-left corner, where the language and
  // Logout buttons are. Error messages still appear.
  devIndicators: false,
  // The shared package is plain TypeScript, so Next compiles it itself.
  transpilePackages: ["@trinetra/shared"],
  experimental: { proxyTimeout: PROXY_TIMEOUT_MS },
  rewrites: async () => [{ source: "/api/:path*", destination: `${backendUrl()}/api/:path*` }],
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
