import type { DeviceId } from "@trinetra/shared";
import type { WebSocket } from "ws";
import type { MainCommand, SnapCommand } from "./messages";

/** WebSocket close codes the devices can read. */
export const CLOSE_BAD_TOKEN = 1008;
export const CLOSE_REPLACED = 4000;

/** Holds at most one live connection per device. */
export class DeviceHub {
  private readonly sockets = new Map<DeviceId, WebSocket>();

  /** Makes this the device's connection and closes the one it had before. */
  connect(device: DeviceId, socket: WebSocket): void {
    const previous = this.sockets.get(device);
    this.sockets.set(device, socket);
    previous?.close(CLOSE_REPLACED, "replaced by a new connection");
  }

  /** Returns false if the socket had already been replaced, so the device is still connected. */
  disconnect(device: DeviceId, socket: WebSocket): boolean {
    if (this.sockets.get(device) !== socket) return false;
    this.sockets.delete(device);
    return true;
  }

  isCurrent(device: DeviceId, socket: WebSocket): boolean {
    return this.sockets.get(device) === socket;
  }

  isConnected(device: DeviceId): boolean {
    return this.sockets.has(device);
  }

  /** Returns false when there is no open connection to send on. */
  send(device: DeviceId, message: MainCommand | SnapCommand): boolean {
    const socket = this.sockets.get(device);
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }
}
