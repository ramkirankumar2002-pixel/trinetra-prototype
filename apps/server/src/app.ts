import websocket from "@fastify/websocket";
import { WEIGHBRIDGE_ID } from "@trinetra/shared";
import Fastify, { type FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import { LoginLockout } from "./auth/lockout";
import { registerAuthRoutes } from "./auth/routes";
import type { Env } from "./config/env";
import { createDb, type Database } from "./db/client";
import { registerErrorHandling, sendError } from "./errors/handler";
import { createHardware, type Hardware } from "./hardware";
import { loadHardwareSettings } from "./hardware/settings";
import type { HardwareSettings } from "./hardware/state";
import { loggerOptions } from "./logger";
import { registerSecurityPlugins } from "./plugins/security";
import { createEventTransaction, type EventTransaction } from "./realtime/after-commit";
import { forwardHardware } from "./realtime/forward-hardware";
import { createSocketServer, type SocketServer } from "./realtime/socket-server";
import { upgradesWithoutSocketIo } from "./realtime/upgrades";
import { registerAnprRoutes } from "./routes/anpr";
import { registerApprovalRoutes } from "./routes/approvals";
import { registerDemoRoutes } from "./routes/demo";
import { registerDevicePhotoRoute } from "./routes/device-photo";
import { registerDevReaderRoutes } from "./routes/dev-readers";
import { DEVICE_SOCKET_OPTIONS, registerDeviceSocket } from "./routes/device-socket";
import { registerFileRoutes } from "./routes/files";
import { registerHealthRoute } from "./routes/health";
import { registerKioskRoutes } from "./routes/kiosk";
import { registerPublicRoutes } from "./routes/public";
import { registerStoreRoutes } from "./routes/store";
import { registerSupervisorRoutes } from "./routes/supervisor";
import { registerTestRoutes } from "./routes/test-routes";
import { registerTicketRoutes } from "./routes/tickets";
import { registerUploadRoutes } from "./routes/upload";
import { createReaders, type Readers } from "./services/readers";
import { createStorage, LocalStorage, type StorageService } from "./services/storage";
import { AnprSession } from "./tickets/anpr-session";

export interface AppOptions {
  env: Env;
  /** Off by default. A stream lets tests read what was logged. */
  logger?: boolean | DestinationStream;
  /** The clock for the login lock. Tests replace it. */
  now?: () => number;
  /** Defaults to the driver named by STORAGE_DRIVER. */
  storage?: StorageService;
  /** For tests: fixed settings or another loader instead of the settings table. */
  hardware?: {
    settings?: HardwareSettings;
    loadSettings?: () => Promise<HardwareSettings>;
    photoTimeoutMs?: number;
  };
  /** For tests: a pretend network for the plate and invoice services. */
  readers?: { fetch: typeof fetch };
}

declare module "fastify" {
  interface FastifyInstance {
    /** `ready` settles after the first attempt to read the weighbridge settings. */
    hardware: Hardware;
    /** Live events to the browsers. */
    realtime: SocketServer;
    /** A database transaction whose emitAfterCommit() events are sent after it commits. */
    eventTransaction: EventTransaction;
    /** Number plate and invoice reading. */
    readers: Readers;
    db: Database;
    storage: StorageService;
    /** The plate reads of the truck on the bridge now. */
    anpr: AnprSession;
  }
}

/** Builds the app without listening, so tests can call it with app.inject(). */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { env, logger = false, now, storage = createStorage(options.env) } = options;
  const app = Fastify({
    logger: logger === false ? false : loggerOptions(logger === true ? undefined : logger),
    // Errors found before a route is chosen, such as a badly encoded address.
    frameworkErrors: (error, request, reply) => void sendError(error, request, reply),
  });

  await registerSecurityPlugins(app, env);
  registerErrorHandling(app);
  await app.register(websocket, {
    // Only /device here; Socket.IO handles its own connections on the same port.
    options: { ...DEVICE_SOCKET_OPTIONS.options, server: upgradesWithoutSocketIo(app.server) },
  });
  const realtime = createSocketServer(app, env);
  app.decorate("realtime", realtime);
  // Before the server closes: it waits for open connections to end.
  app.addHook("preClose", () => realtime.close());

  // Connects on the first query, so building the app does not need the database.
  const database = createDb(env.DATABASE_URL);
  app.addHook("onClose", () => database.close());
  app.decorate("db", database.db);
  app.decorate("storage", storage);
  app.decorate("eventTransaction", createEventTransaction(database.db, realtime.publish, app.log));

  const fixedSettings = options.hardware?.settings;
  const photoTimeoutMs = options.hardware?.photoTimeoutMs;
  const hardware = createHardware({
    log: app.log,
    db: database.db,
    storage,
    ...(photoTimeoutMs === undefined ? {} : { photoTimeoutMs }),
    loadSettings:
      options.hardware?.loadSettings ??
      (fixedSettings
        ? () => Promise.resolve(fixedSettings)
        : () => loadHardwareSettings(database.db)),
  });
  app.decorate("hardware", hardware);
  app.decorate(
    "readers",
    createReaders({
      env,
      db: database.db,
      storage,
      photos: hardware.photos,
      log: app.log,
      ...options.readers,
    }),
  );
  app.addHook("onReady", () => hardware.start());
  const forwarding = forwardHardware(hardware, realtime);
  app.addHook("preClose", () => {
    forwarding.stop();
    hardware.stop();
  });
  registerDeviceSocket(app, { env, hub: hardware.hub, listener: hardware.listener });
  registerKioskRoutes(app, hardware.state);
  const anpr = new AnprSession();
  app.decorate("anpr", anpr);
  hardware.bus.on("truck:left", () => anpr.clear());
  registerAnprRoutes(app);
  registerTicketRoutes(app, env);
  registerUploadRoutes(app);
  registerSupervisorRoutes(app);
  registerApprovalRoutes(app);
  registerStoreRoutes(app);
  registerPublicRoutes(app);
  registerDemoRoutes(app, env, now);
  await registerDevicePhotoRoute(app, { env, photos: hardware.photos });

  registerHealthRoute(app, database.sql);
  if (storage instanceof LocalStorage) registerFileRoutes(app, storage);
  registerAuthRoutes(app, { env, db: database.db, lockout: new LoginLockout(now) });
  if (env.NODE_ENV === "test") registerTestRoutes(app);
  // These spend API quota, so a deployed server must never have them.
  if (env.NODE_ENV !== "production") registerDevReaderRoutes(app);

  app.addHook("onReady", async () => {
    app.log.info(`Trinetra backend ready for weighbridge ${WEIGHBRIDGE_ID}`);
  });

  return app;
}
