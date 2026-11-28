// POST /api/cam/:camera: an ESP32-CAM's newest frame. The body is the JPEG itself, not a
// form. The camera proves which one it is with its own token.
import { CAMERA_IDS } from "@trinetra/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env";
import { CAMERA_FRAME_RATE_LIMIT, MAX_FRAME_BYTES } from "../config/limits";
import { AppError } from "../errors/app-error";
import type { Hardware } from "../hardware";
import { DEVICE_TOKEN_HEADER, identifyDevice } from "../hardware/auth";

const params = z.object({ camera: z.enum(CAMERA_IDS) });

export async function registerCameraFrameRoute(
  app: FastifyInstance,
  options: { env: Env; hardware: Hardware },
): Promise<void> {
  const { env, hardware } = options;

  // Its own scope, so raw image bodies are accepted on this route only.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("image/jpeg", { parseAs: "buffer" }, (_request, body, done) =>
      done(null, body),
    );

    scope.post(
      "/api/cam/:camera",
      {
        bodyLimit: MAX_FRAME_BYTES,
        config: { rateLimit: CAMERA_FRAME_RATE_LIMIT },
        // Two cameras send a frame every second or two: only problems are logged.
        logLevel: "warn",
        // Checked before the body is read, so strangers cannot send us anything big.
        onRequest: async (request) => {
          const device = identifyDevice(env, request.headers[DEVICE_TOKEN_HEADER]);
          if (!device) {
            throw new AppError(401, "INVALID_DEVICE_TOKEN", "Wrong or missing device token.");
          }
          const parsed = params.safeParse(request.params);
          if (!parsed.success) throw new AppError(404, "NOT_FOUND", "There is no such camera.");
          // Each camera has the other's name wrong at most once: front and back never swap.
          if (device !== parsed.data.camera) {
            throw new AppError(403, "WRONG_CAMERA", "This token belongs to another device.");
          }
        },
      },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) {
          throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG photo.");
        }
        const { camera } = params.parse(request.params);
        hardware.listener.cameraFrame(camera, request.body);
        return reply.status(204).send();
      },
    );
  });
}
