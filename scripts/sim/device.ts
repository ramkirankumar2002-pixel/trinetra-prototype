// One simulated board's connection to /device, which reconnects like the real one.
import { WebSocket } from "ws";

const RECONNECT_MS = 2000;
const HEARTBEAT_MS = 5000;
/** Close codes after which retrying cannot help. */
const REFUSED = 1008;
const REPLACED = 4000;

export class SimDevice {
  private socket: WebSocket | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private retry: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly options: {
      name: string;
      url: string;
      token: string;
      onOpen?: () => void;
      onCommand: (command: Record<string, unknown>) => void;
      log: (text: string) => void;
    },
  ) {}

  connect(): void {
    if (this.stopped) return;
    const { name, url, token, onOpen, onCommand, log } = this.options;
    const socket = new WebSocket(url, { headers: { "x-device-token": token } });
    this.socket = socket;

    socket.on("open", () => {
      log(`${name}: connected`);
      onOpen?.();
      this.heartbeat = setInterval(() => this.send({ t: "hb" }), HEARTBEAT_MS);
    });
    socket.on("message", (data) => {
      try {
        onCommand(JSON.parse(data.toString()));
      } catch {
        log(`${name}: received something that is not JSON`);
      }
    });
    socket.on("error", (error) => log(`${name}: ${error.message || "cannot connect"}`));
    socket.on("close", (code, reason) => {
      if (this.socket !== socket) return;
      clearInterval(this.heartbeat);
      if (this.stopped) return;
      if (code === REFUSED || code === REPLACED) {
        log(`${name}: closed by the server (${reason}). Not reconnecting.`);
        return;
      }
      this.retry = setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  /** Drops the connection and comes back after `ms`. */
  goOffline(ms: number): void {
    this.close();
    this.retry = setTimeout(() => {
      this.stopped = false;
      this.connect();
    }, ms);
  }

  close(): void {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    this.socket?.close();
  }
}
