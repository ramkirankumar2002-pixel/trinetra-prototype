// The three role-based parts of the website, each with its own login.
import type { UserRole } from "@trinetra/shared";

export const AREAS = {
  kiosk: { role: "KIOSK", home: "/kiosk", login: "/kiosk/login" },
  supervisor: { role: "SUPERVISOR", home: "/supervisor", login: "/supervisor/login" },
  store: { role: "STORE", home: "/store", login: "/store/login" },
} as const satisfies Record<string, { role: UserRole; home: string; login: string }>;

export type AreaName = keyof typeof AREAS;

/** The area an address belongs to, or undefined for a public page such as /live. */
export function areaOf(pathname: string): AreaName | undefined {
  const first = pathname.split("/")[1] ?? "";
  return Object.hasOwn(AREAS, first) ? (first as AreaName) : undefined;
}
