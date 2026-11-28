// The three role-based parts of the website, each with its own login.
import type { UserRole } from "@trinetra/shared";

export const AREAS = {
  kiosk: { role: "KIOSK", home: "/kiosk", login: "/kiosk/login" },
  supervisor: { role: "SUPERVISOR", home: "/supervisor", login: "/supervisor/login" },
  store: { role: "STORE", home: "/store", login: "/store/login" },
} as const satisfies Record<string, { role: UserRole; home: string; login: string }>;

export type AreaName = keyof typeof AREAS;

/** The demo settings: the store officer's page, though not under /store. */
export const SETTINGS_PATH = "/settings";

/** The area an address belongs to, or undefined for a public page such as /t/<token>. */
export function areaOf(pathname: string): AreaName | undefined {
  if (pathname === SETTINGS_PATH) return "store";
  const first = pathname.split("/")[1] ?? "";
  return Object.hasOwn(AREAS, first) ? (first as AreaName) : undefined;
}

/** A page of this part, other than its login, that a login may go back to. */
function isPageOf(area: AreaName, path: string): boolean {
  if (area === "store" && path === SETTINGS_PATH) return true;
  const { home, login } = AREAS[area];
  // Only letters, digits, dashes and single slashes: nothing that could leave the website.
  return path.startsWith(`${home}/`) && path !== login && /^(\/[A-Za-z0-9-]+)+$/.test(path);
}

/** The login address for someone who was on `path`: it remembers where to come back to. */
export function loginPath(area: AreaName, path: string): string {
  const { login } = AREAS[area];
  return isPageOf(area, path) ? `${login}?next=${encodeURIComponent(path)}` : login;
}

/** Where to go after logging in: the page asked for, if it is one of this part's. */
export function afterLoginPath(area: AreaName, search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next !== null && isPageOf(area, next) ? next : AREAS[area].home;
}
