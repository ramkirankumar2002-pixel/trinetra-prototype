import type { FastifyRequest } from "fastify";
import type { DestinationStream, LoggerOptions } from "pino";

const SECRET_FIELDS = [
  "pin",
  "pinHash",
  "password",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "x-device-token",
];

/** A pino path for one field at one depth: "pin", "*.pin", '*.*["set-cookie"]'. */
function redactPath(field: string, depth: number): string {
  const parents = Array<string>(depth).fill("*").join(".");
  if (field.includes("-")) return `${parents}["${field}"]`;
  return depth === 0 ? field : `${parents}.${field}`;
}

/** Secret fields at the top level of a log entry and up to three levels down. */
const redactPaths = SECRET_FIELDS.flatMap((field) =>
  [0, 1, 2, 3].map((depth) => redactPath(field, depth)),
);

/** Hides secrets that travel in the address, such as the signature of a file link. */
export function scrubUrl(url: string): string {
  return url.replace(/([?&](?:sig|token)=)[^&]*/g, "$1[Redacted]");
}

export function loggerOptions(
  stream?: DestinationStream,
): LoggerOptions & { stream?: DestinationStream } {
  return {
    level: "info",
    redact: { paths: redactPaths, censor: "[Redacted]" },
    serializers: {
      // Headers and bodies are never logged here.
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: scrubUrl(request.url),
        remoteAddress: request.ip,
      }),
    },
    ...(stream ? { stream } : {}),
  };
}
