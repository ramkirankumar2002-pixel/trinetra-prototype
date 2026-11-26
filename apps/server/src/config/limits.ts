/** Largest photo or PDF the API accepts. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Requests per minute from one address, for the whole API. */
export const GENERAL_RATE_LIMIT = { max: 300, timeWindow: "1 minute" };

/** Stricter limit on login, on top of the per-username lock. */
export const LOGIN_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

/** The kiosk may read the live state up to 20 times a second. */
export const KIOSK_STATE_RATE_LIMIT = { max: 1200, timeWindow: "1 minute" };

/** The phone upload routes need no login, so they get a tighter limit. */
export const UPLOAD_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

/** How long the QR code for the invoice upload works. */
export const UPLOAD_LINK_MS = 10 * 60 * 1000;

export const SESSION_SECONDS = 12 * 60 * 60;
export const SOCKET_TOKEN_SECONDS = 60;

export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_SECONDS = 60;

/** A STARTED ticket with no activity for this long is abandoned, and no longer resumed. */
export const ABANDON_AFTER_MS = 10 * 60 * 1000;
