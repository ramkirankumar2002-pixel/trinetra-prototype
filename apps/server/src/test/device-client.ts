// A pretend device for tests: connects like an ESP32 and records what it is sent.
import { WebSocket } from "ws";

export const TEST_DEVICE_TOKENS = {
  main: "test-main-device-token-0001",
  front: "test-front-camera-token-0001",
  back: "test-back-camera-token-0001",
};

/** The environment settings that give the test devices their tokens. */
export const deviceTokenEnv = {
  DEVICE_TOKEN: TEST_DEVICE_TOKENS.main,
  CAM_FRONT_TOKEN: TEST_DEVICE_TOKENS.front,
  CAM_BACK_TOKEN: TEST_DEVICE_TOKENS.back,
};

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export interface TestDevice {
  socket: WebSocket;
  /** Commands received from the backend, oldest first. */
  received: Record<string, unknown>[];
  closed: Promise<{ code: number; reason: string }>;
  send(message: unknown): void;
}

/** Connects to a listening server. `token` undefined sends no token header at all. */
export async function connectDevice(baseUrl: string, token?: string): Promise<TestDevice> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/device`, {
    headers: token === undefined ? {} : { "x-device-token": token },
  });
  const received: Record<string, unknown>[] = [];
  socket.on("message", (data) => received.push(JSON.parse(data.toString())));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return {
    socket,
    received,
    closed,
    send: (message) => socket.send(typeof message === "string" ? message : JSON.stringify(message)),
  };
}
