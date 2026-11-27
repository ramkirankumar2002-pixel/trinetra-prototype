// Where live events come from. API calls need no address: the browser calls /api/* on the
// website itself, and Next forwards it to the backend (BACKEND_URL in next.config.ts).
// NEXT_PUBLIC_ values are built into the browser code, and must be written out in full
// here for Next.js to fill them in.

const LOCAL_BACKEND = "http://localhost:4000";

export function socketUrl(): string {
  const value = process.env.NEXT_PUBLIC_SOCKET_URL;
  // "pnpm lan": the website forwards /socket.io/ to the backend.
  if (value === "same-origin") return window.location.origin;
  if (value) return value.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return LOCAL_BACKEND;
  throw new Error("NEXT_PUBLIC_SOCKET_URL is not set.");
}
