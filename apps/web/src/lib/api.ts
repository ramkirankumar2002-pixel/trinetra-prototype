// The one way the website calls the backend. Addresses are on the website itself (/api/*,
// forwarded by Next), so the login cookie goes along. Every failure is an ApiError with a
// code, which the screens turn into words in the user's language.
import type { ErrorResponse } from "@trinetra/shared";
import { AREAS, areaOf, loginPath } from "./areas";

export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    /** The HTTP status, or 0 when there was no answer at all. */
    readonly status: number,
    /** The backend's code, or NETWORK_ERROR, SERVER_UNREACHABLE or BAD_RESPONSE. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Trying the same request again may work: nothing was refused. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export interface RequestOptions {
  /** Sent as JSON, or as it is when it is a FormData. */
  body?: unknown;
  /**
   * Every POST, PATCH and PUT carries one. Pass the same key again when retrying the same
   * press, so it cannot act twice; without it, each call gets a new key.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** False for a caller that handles "not logged in" itself, such as a login page. */
  redirectOn401?: boolean;
}

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const KEYED = new Set<Method>(["POST", "PATCH", "PUT"]);

export function newIdempotencyKey(): string {
  // randomUUID() exists only on HTTPS and localhost; getRandomValues() everywhere.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ApiClientOptions {
  fetch?: typeof fetch;
  /** The page's path now. */
  currentPath?: () => string;
  /** Opens a page, dropping everything the old login had loaded. */
  goTo?: (path: string) => void;
}

export function createApiClient(options: ApiClientOptions = {}) {
  const {
    currentPath = () => window.location.pathname,
    goTo = (path: string) => window.location.assign(path),
  } = options;

  /** The login has ended: go to the login page of the part of the website we are in. */
  function sendToLogin(): void {
    const path = currentPath();
    const area = areaOf(path);
    if (area && path !== AREAS[area].login) goTo(loginPath(area, path));
  }

  async function request<T>(method: Method, path: string, init: RequestOptions = {}): Promise<T> {
    const { body, signal, redirectOn401 = true } = init;
    const headers: Record<string, string> = { accept: "application/json" };
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !isForm) headers["content-type"] = "application/json";
    if (KEYED.has(method)) headers["idempotency-key"] = init.idempotencyKey ?? newIdempotencyKey();

    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(path, {
        method,
        headers,
        credentials: "include",
        cache: "no-store",
        ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      // A cancelled request is not a failure to report.
      if (signal?.aborted) throw error;
      throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the server.");
    }

    const data: unknown = await response.json().catch(() => undefined);
    if (response.ok) {
      if (data === undefined) {
        throw new ApiError(response.status, "BAD_RESPONSE", "The server's answer was not JSON.");
      }
      return data as T;
    }

    const problem = (data as Partial<ErrorResponse> | undefined)?.error;
    if (!problem?.code) {
      // Not the backend's own answer: Next's proxy says this when the backend is down.
      throw new ApiError(response.status, "SERVER_UNREACHABLE", "Cannot reach the server.");
    }
    // Only for an ended login. A wrong PIN is also a 401, and stays on the login page.
    if (response.status === 401 && problem.code === "NOT_LOGGED_IN" && redirectOn401) {
      sendToLogin();
    }
    throw new ApiError(response.status, problem.code, problem.message, problem.details);
  }

  return {
    get: <T>(path: string, init?: RequestOptions) => request<T>("GET", path, init),
    post: <T>(path: string, init?: RequestOptions) => request<T>("POST", path, init),
    patch: <T>(path: string, init?: RequestOptions) => request<T>("PATCH", path, init),
    put: <T>(path: string, init?: RequestOptions) => request<T>("PUT", path, init),
  };
}

/** For use in the browser only. */
export const api = createApiClient();
