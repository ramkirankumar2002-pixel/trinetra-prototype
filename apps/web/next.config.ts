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

/** The address in the slips' QR codes, or "" for the address the page was opened on. */
function publicWebUrl(): string {
  const value = (process.env.PUBLIC_WEB_URL ?? "").replace(/\/+$/, "");
  const host = value ? new URL(value).hostname : "";
  if (host === "localhost" || host === "[::1]" || host.startsWith("127.")) {
    throw new Error("PUBLIC_WEB_URL must be an address a phone can open, not localhost.");
  }
  return value;
}

const publicUrl = publicWebUrl();
// "pnpm lan": the live connection also goes through the website, so a phone only needs the
// one https address (a self-signed certificate is accepted per address and port).
const liveThroughWebsite = process.env.NEXT_PUBLIC_SOCKET_URL === "same-origin";

const nextConfig: NextConfig = {
  env: { PUBLIC_WEB_URL: publicUrl },
  // Lets a phone on the same network use the development server.
  ...(publicUrl ? { allowedDevOrigins: [new URL(publicUrl).hostname] } : {}),
  // Otherwise Next would redirect Socket.IO's "/socket.io/" to "/socket.io".
  ...(liveThroughWebsite ? { skipTrailingSlashRedirect: true } : {}),
  // Stops `next dev` from writing AGENTS.md; this project's rules live in CLAUDE.md.
  agentRules: false,
  // The floating dev-tools badge sits over the bottom-left corner, where the language and
  // Logout buttons are. Error messages still appear.
  devIndicators: false,
  // The shared package is plain TypeScript, so Next compiles it itself.
  transpilePackages: ["@trinetra/shared"],
  rewrites: async () => [
    { source: "/api/:path*", destination: `${backendUrl()}/api/:path*` },
    ...(liveThroughWebsite
      ? [{ source: "/socket.io/", destination: `${backendUrl()}/socket.io/` }]
      : []),
  ],
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
