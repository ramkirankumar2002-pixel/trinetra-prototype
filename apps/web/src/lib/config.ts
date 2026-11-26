// Where the backend is. NEXT_PUBLIC_ values are built into the browser code, and must be
// written out in full here for Next.js to fill them in.

const LOCAL_BACKEND = "http://localhost:4000";

function address(value: string | undefined, name: string): string {
  if (value) return value.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return LOCAL_BACKEND;
  throw new Error(`${name} is not set.`);
}

export const apiUrl = () => address(process.env.NEXT_PUBLIC_API_URL, "NEXT_PUBLIC_API_URL");

export const socketUrl = () =>
  address(process.env.NEXT_PUBLIC_SOCKET_URL, "NEXT_PUBLIC_SOCKET_URL");
