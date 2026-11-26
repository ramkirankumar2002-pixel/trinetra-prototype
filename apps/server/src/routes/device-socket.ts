import type { CameraId, DeviceId } from "@trinetra/shared";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type { RawData } from "ws";
import type { Env } from "../config/env";
import { DEVICE_TOKEN_HEADER, identifyDevice } from "../hardware/auth";
import { CLOSE_BAD_TOKEN, type DeviceHub } from "../hardware/hub";
import {
  cameraMessageSchema,
  mainMessageSchema,
  parseMessage,
  type CameraMessage,
  type MainMessage,
} from "../hardware/messages";

/** What the rest of the backend hears from the devices. Only checked messages arrive. */
export interface DeviceListener {
  mainMessage(message: MainMessage): void;
  cameraMessage(camera: CameraId, message: CameraMessage): void;
  /** The device's connection ended, or a new one is taking its place. */
  disconnected(device: DeviceId): void;
}

/** A faulty board can send rubbish many times a second: do not fill the log with it. */
const BAD_MESSAGE_LOG_EVERY_MS = 10_000;

function badMessageLogger(log: FastifyBaseLogger, device: DeviceId) {
  let loggedAt = 0;
  let skipped = 0;
  return (text: string) => {
    if (Date.now() - loggedAt < BAD_MESSAGE_LOG_EVERY_MS) {
      skipped += 1;
      return;
    }
    log.warn(
      { device, received: text.slice(0, 200), skippedSinceLastLog: skipped },
      "ignored a bad message from a device",
    );
    loggedAt = Date.now();
    skipped = 0;
  };
}

/** For registering @fastify/websocket. Device messages are tiny; photos go over HTTP. */
export const DEVICE_SOCKET_OPTIONS = { options: { maxPayload: 4096 } };

/** The /device WebSocket. @fastify/websocket must already be registered. */
export function registerDeviceSocket(
  app: FastifyInstance,
  options: { env: Env; hub: DeviceHub; listener: DeviceListener },
): void {
  const { env, hub, listener } = options;

  app.get("/device", { websocket: true }, (socket, request) => {
    const device = identifyDevice(env, request.headers[DEVICE_TOKEN_HEADER]);
    if (!device) {
      request.log.warn({ ip: request.ip }, "refused a device connection: wrong or missing token");
      // No message listener is added, so nothing this connection sends is ever read.
      socket.close(CLOSE_BAD_TOKEN, "wrong or missing device token");
      return;
    }

    // A new connection starts fresh: old readings do not carry over.
    listener.disconnected(device);
    hub.connect(device, socket);
    request.log.info({ device }, "device connected");
    const logBadMessage = badMessageLogger(request.log, device);

    socket.on("message", (data: RawData, isBinary: boolean) => {
      // A replaced connection may still deliver a few messages while it closes.
      if (!hub.isCurrent(device, socket)) return;
      const text = isBinary ? "(binary data)" : data.toString();

      if (device === "main") {
        const message = isBinary ? undefined : parseMessage(mainMessageSchema, text);
        if (message) listener.mainMessage(message);
        else logBadMessage(text);
        return;
      }
      const message = isBinary ? undefined : parseMessage(cameraMessageSchema, text);
      if (!message) {
        logBadMessage(text);
      } else if (message.t === "hello" && message.cam !== device) {
        // The two cameras have each other's tokens: front and back photos would be swapped.
        request.log.error({ device, saysItIs: message.cam }, "camera token does not match");
        socket.close(CLOSE_BAD_TOKEN, `this token belongs to the ${device} camera`);
      } else {
        listener.cameraMessage(device, message);
      }
    });

    socket.on("error", (error) => request.log.warn({ device, err: error }, "device socket error"));
    socket.on("close", (code) => {
      if (!hub.disconnect(device, socket)) return;
      request.log.info({ device, code }, "device disconnected");
      listener.disconnected(device);
    });
  });
}
