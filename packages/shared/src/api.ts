// Shapes shared by the backend and the website (build plan section 7).

/** Every API error looks like this. */
export interface ErrorResponse {
  error: {
    /** Stable machine-readable code, e.g. VALIDATION_ERROR. */
    code: string;
    message: string;
    /** Extra information for some codes, such as the fields that failed validation. */
    details?: unknown;
  };
}

/** The `details` of a VALIDATION_ERROR. */
export interface FieldError {
  field: string;
  message: string;
}
