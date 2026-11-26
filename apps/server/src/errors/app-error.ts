/** An error the API is allowed to show to the caller. */
export class AppError extends Error {
  override name = "AppError";

  constructor(
    readonly statusCode: number,
    /** Stable machine-readable code, e.g. WRONG_STAGE. */
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
