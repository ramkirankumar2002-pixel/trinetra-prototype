// Puts the hardware parts together and runs their timers.
import { gramsToKg, type CameraId, type DeviceId } from "@trinetra/shared";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "../db/client";
import type { StorageService } from "../services/storage";
import type { DeviceListener } from "../routes/device-socket";
import type { MainMessage } from "./messages";
import { HardwareCommands } from "./commands";
import { createHardwareBus } from "./events";
import { DeviceHub } from "./hub";
import { PhotoService } from "./photos";
import { WeighbridgeSignals } from "./signals";
import { SimulatedWeight } from "./simulated-weight";
import { HardwareState, type HardwareSettings } from "./state";

const TICK_MS = 250;
/** Far above any real truck: a reading beyond this is a fault, not a weight. */
const MAX_KG = 200_000;
const SETTINGS_RETRY_MS = 5000;
/** So a re-seeded setting takes effect without restarting the server. */
const SETTINGS_REFRESH_MS = 30_000;

/** Everything the boards send: the main ESP32's messages and the cameras' frames. */
export interface HardwareListener extends DeviceListener {
  cameraFrame(camera: CameraId, data: Buffer): void;
}

export interface HardwareOptions {
  loadSettings: () => Promise<HardwareSettings>;
  log: FastifyBaseLogger;
  db: Database;
  storage: StorageService;
  /** Replaced by tests. */
  now?: () => number;
  /** How long to wait for a fresh camera frame. */
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
  const signals = new WeighbridgeSignals(commands, state, bus);
  const photos = new PhotoService({
    storage,
    db,
    log,
    isOnline: (camera) => state.isOnline(camera),
    onSaved: (camera, { storagePath }) => bus.emit("camera:photo", { camera, storagePath }),
    ...(now === undefined ? {} : { now }),
    ...(photoTimeoutMs === undefined ? {} : { waitMs: photoTimeoutMs }),
  });

  // When each real board was last heard. Kept after it goes offline, and not fed by the
  // simulated weight: the settings page must never show a board that is not there.
  const heard = new Map<DeviceId, Date>();

  /** The one place where the model's grams become truck kilograms. */
  function addGrams(message: Extract<MainMessage, { t: "w" }>): void {
    // Without the model scale a weight means nothing yet; the board is still heard.
    if (!settings) return state.seen("main");
    const kg = gramsToKg(message.g, settings.modelScaleKgPerG);
    if (Math.abs(kg) > MAX_KG) return state.seen("main");
    state.addWeight({ kg, stable: message.stable, pos: message.pos === "ok" });
  }

  let loggedFault: string | null = null;

  const listener: HardwareListener = {
    mainMessage: (message) => {
      heard.set("main", new Date());
      const fault = message.t === "tamper" ? message.reason : null;
      if ((message.t === "tamper" || message.t === "tamper_clear") && fault !== loggedFault) {
        loggedFault = fault;
        // Written down even in demo mode, when it changes nothing on the screens.
        if (fault) log.warn({ reason: fault }, "the weighbridge reports tampering");
        else log.info("the weighbridge reports healthy wiring");
      }
      // In demo mode the ESP32 still takes commands, but what it reports is set aside.
      if (simulatedWeight.current()) return;
      switch (message.t) {
        case "w":
          return addGrams(message);
        case "hb":
          return state.seen("main");
        case "tamper":
          state.seen("main");
          return state.setFault(message.reason);
        case "tamper_clear":
          state.seen("main");
          return state.setFault(null);
      }
    },
    cameraFrame: (camera, data) => {
      // Throws for anything that is not a JPEG, before the camera counts as heard.
      photos.addFrame(camera, data);
      heard.set(camera, new Date());
      state.seen(camera);
    },
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

  async function reloadSettings(): Promise<void> {
    const next = await loadSettings();
    // Readings converted with another scale must not be mixed with new ones.
    if (settings && settings.modelScaleKgPerG !== next.modelScaleKgPerG) state.forgetReadings();
    settings = next;
  }

  async function refreshSettings(): Promise<void> {
    try {
      await reloadSettings();
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
    signals,
    listener,
    ready,
    /** Reads the settings again now, after one was changed on /settings. */
    reloadSettings,
    /** The model scale in use, or undefined until the settings have been read. */
    modelScale: () => settings?.modelScaleKgPerG,
    /** When the real board last sent anything, since the server started. */
    lastHeard: (device: DeviceId): Date | null => heard.get(device) ?? null,
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
