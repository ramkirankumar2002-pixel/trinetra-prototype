// Puts the hardware parts together and runs their timers.
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import type { StorageService } from "../services/storage";
import type { DeviceListener } from "../routes/device-socket";
import { HardwareCommands } from "./commands";
import { createHardwareBus } from "./events";
import { DeviceHub } from "./hub";
import { PhotoService } from "./photos";
import { SimulatedWeight } from "./simulated-weight";
import { HardwareState, type HardwareSettings } from "./state";

const TICK_MS = 250;
const SETTINGS_RETRY_MS = 5000;
/** So a re-seeded setting takes effect without restarting the server. */
const SETTINGS_REFRESH_MS = 30_000;

export interface HardwareOptions {
  loadSettings: () => Promise<HardwareSettings>;
  log: FastifyBaseLogger;
  db: Database;
  storage: StorageService;
  /** Replaced by tests. */
  now?: () => number;
  photoTimeoutMs?: number;
}

export function createHardware(options: HardwareOptions) {
  const { loadSettings, log, db, storage, now, photoTimeoutMs } = options;
  let settings: HardwareSettings | undefined;
  const currentSettings = () => settings;

  const bus = createHardwareBus();
  const hub = new DeviceHub();
  const state = new HardwareState(bus, currentSettings, now);
  const commands = new HardwareCommands(hub, state, currentSettings);
  const simulatedWeight = new SimulatedWeight(state);
  const photos = new PhotoService({
    hub,
    storage,
    db,
    log,
    ...(photoTimeoutMs === undefined ? {} : { timeoutMs: photoTimeoutMs }),
  });

  const listener: DeviceListener = {
    mainMessage: (message) => {
      // In demo mode the ESP32 still takes commands, but its readings are set aside.
      if (simulatedWeight.current()) return;
      if (message.t === "w") state.addWeight(message);
      else state.seen("main");
    },
    cameraMessage: (camera) => state.seen(camera),
    disconnected: (device) => {
      if (device === "main" && simulatedWeight.current()) return;
      state.disconnected(device);
    },
  };

  let tick: NodeJS.Timeout | undefined;
  let settingsTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  let firstAttemptDone: () => void;
  const ready = new Promise<void>((resolve) => (firstAttemptDone = resolve));

  async function refreshSettings(): Promise<void> {
    try {
      settings = await loadSettings();
    } catch (error) {
      // The last good settings stay. Until there are some, nothing can be captured.
      if (!stopped) log.warn({ err: error }, "could not read the weighbridge settings");
    }
    firstAttemptDone();
    if (stopped) return;
    settingsTimer = setTimeout(
      () => void refreshSettings(),
      settings ? SETTINGS_REFRESH_MS : SETTINGS_RETRY_MS,
    ).unref();
  }

  return {
    bus,
    hub,
    state,
    commands,
    photos,
    simulatedWeight,
    listener,
    ready,
    start(): void {
      tick = setInterval(() => state.checkTimeouts(), TICK_MS).unref();
      // Not awaited: the server starts even while the database is unreachable.
      void refreshSettings();
    },
    stop(): void {
      stopped = true;
      clearInterval(tick);
      clearTimeout(settingsTimer);
      photos.stop();
      simulatedWeight.stopTimer();
    },
  };
}

export type Hardware = ReturnType<typeof createHardware>;
