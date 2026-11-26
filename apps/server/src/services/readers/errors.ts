export type ApiService = "plate_recognizer" | "gemini";

export type ReaderErrorCode =
  /** No API key is set. */
  | "NOT_CONFIGURED"
  /** Wrong key, or no credits left. */
  | "AUTH_OR_CREDITS"
  /** Too many requests, or the free quota is used up. */
  | "RATE_LIMITED"
  /** The service says it is overloaded or broken. */
  | "BUSY"
  | "TIMEOUT"
  | "NETWORK"
  /** An answer we could not understand. */
  | "BAD_ANSWER"
  | "REQUEST_REFUSED";

/** A failure of an outside service. Its message never contains a key or a request header. */
export class ReaderError extends Error {
  override name = "ReaderError";

  constructor(
    readonly service: ApiService,
    readonly code: ReaderErrorCode,
    message: string,
  ) {
    super(`${service}: ${message}`);
  }
}
