import { WrongStageError, type ErrorResponse, type FieldError } from "@trinetra/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./app-error";

const CLIENT_ERROR_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  406: "NOT_ACCEPTABLE",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
};

function toAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;

  // From the shared ticket state machine: the ticket is not at the right step for this.
  if (error instanceof WrongStageError) return new AppError(409, error.code, error.message);

  if (error instanceof ZodError) {
    const details: FieldError[] = error.issues.map((issue) => ({
      field: issue.path.join(".") || "body",
      message: issue.message,
    }));
    return new AppError(400, "VALIDATION_ERROR", "Some values are missing or wrong.", details);
  }

  // Fastify and its plugins mark their own errors with an FST_ code; those messages are safe.
  // Anything else is unexpected, even if it carries a status code.
  const { code, statusCode, message } = (error ?? {}) as Partial<FastifyError>;
  if (code?.startsWith("FST_") && statusCode && statusCode >= 400 && statusCode < 500) {
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      return new AppError(413, "FILE_TOO_LARGE", "The file is larger than 8 MB.");
    }
    return new AppError(statusCode, CLIENT_ERROR_CODES[statusCode] ?? "BAD_REQUEST", message ?? "");
  }
  return undefined;
}

export function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  let known = toAppError(error);
  if (!known) {
    // The full error goes to the log only.
    request.log.error({ err: error }, "unexpected error");
    known = new AppError(500, "INTERNAL_ERROR", "Something went wrong on the server.");
  }

  const body: ErrorResponse = {
    error: {
      code: known.code,
      message: known.message,
      ...(known.details === undefined ? {} : { details: known.details }),
    },
  };
  return reply.status(known.statusCode).send(body);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler(sendError);
  // Unknown addresses are rate limited too, so they cannot be used to flood the server.
  app.setNotFoundHandler({ preHandler: app.rateLimit() }, (request, reply) =>
    sendError(new AppError(404, "NOT_FOUND", "There is nothing at this address."), request, reply),
  );
}
