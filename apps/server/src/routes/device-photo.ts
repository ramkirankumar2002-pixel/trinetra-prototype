import type { CameraId } from "@trinetra/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Env } from "../config/env";
import { MAX_UPLOAD_BYTES } from "../config/limits";
import { AppError } from "../errors/app-error";
import { DEVICE_TOKEN_HEADER, identifyDevice } from "../hardware/auth";
import type { PhotoService } from "../hardware/photos";

const params = z.object({ photoId: z.uuid() });

/** POST /api/device/photo/:photoId: the body is the JPEG itself, not a form. */
export async function registerDevicePhotoRoute(
  app: FastifyInstance,
  options: { env: Env; photos: PhotoService },
): Promise<void> {
  const { env, photos } = options;
  const cameraOf = new WeakMap<FastifyRequest, CameraId>();

  // Its own scope, so raw image bodies are accepted on this route only.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("image/jpeg", { parseAs: "buffer" }, (_request, body, done) =>
      done(null, body),
    );

    scope.post(
      "/api/device/photo/:photoId",
      {
        bodyLimit: MAX_UPLOAD_BYTES,
        // Checked before the body is read, so strangers cannot send us 8 MB.
        onRequest: async (request) => {
          const device = identifyDevice(env, request.headers[DEVICE_TOKEN_HEADER]);
          if (!device) {
            throw new AppError(401, "INVALID_DEVICE_TOKEN", "Wrong or missing device token.");
          }
          if (device === "main") {
            throw new AppError(403, "WRONG_DEVICE", "Only a camera can upload photos.");
          }
          cameraOf.set(request, device);
        },
      },
      async (request, reply) => {
        const parsed = params.safeParse(request.params);
        if (!parsed.success) {
          throw new AppError(404, "UNKNOWN_PHOTO_ID", "This photo id cannot be used.");
        }
        if (!Buffer.isBuffer(request.body)) {
          throw new AppError(415, "UNSUPPORTED_FILE_TYPE", "Send a JPEG photo.");
        }
        const photo = await photos.receive(
          cameraOf.get(request)!,
          parsed.data.photoId,
          request.body,
        );
        reply.status(201);
        return { id: photo.id, sha256: photo.sha256 };
      },
    );
  });
}
